"""LLMClient — unified entry point for LLM API calls.

Consolidates call_llm / call_llm_stream / call_llm_json from
the old services/llm/service.py into a single class with shared
retry, rate-limiting, and logging logic.
"""

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

import httpx

from core.config import LLM_CONCURRENT_LIMIT
from core.exceptions import LLMParseError, NoProviderAvailable
from infrastructure.llm.circuit import async_retry, backoff_delay

from .logging import LogWorker
from .parsing import _safe_parse_json
from .router import ProfileRouter

log = logging.getLogger(__name__)


@dataclass
class CallContext:
    """Metadata for a single LLM call — user, record, case context."""

    purpose: str = "other"
    user_id: int | None = None
    record_id: int | None = None
    case_id: int | None = None
    log_meta: dict | None = None


@dataclass
class _CallState:
    """Internal state built per-call from config + context."""

    _config: object = field(default=None, repr=False)
    provider_name: str = "unknown"
    model: str = "unknown"
    config_id: int | None = None
    api_key: str = ""
    base_url: str = ""
    price_input: float = 0.0
    price_output: float = 0.0


class LLMClient:
    """Unified LLM caller with retry, concurrency limiting, and logging."""

    def __init__(
        self,
        http: httpx.AsyncClient,
        router: ProfileRouter,
        log_worker: LogWorker,
        concurrency: int | None = None,
        metrics=None,
    ):
        self._http = http
        self._router = router
        self._log_worker = log_worker
        self._metrics = metrics
        self._sem = asyncio.Semaphore(concurrency or LLM_CONCURRENT_LIMIT)

    def _record_metrics(self, *, status: str, tokens: int, cost: float, latency_ms: int) -> None:
        if self._metrics:
            self._metrics.record_llm_call(status=status, tokens=tokens, cost=cost, latency_ms=latency_ms)

    # ── Public API ──

    async def call(
        self,
        messages: list[dict],
        *,
        purpose: str,
        temperature: float = 0.7,
        max_tokens: int = 512,
        timeout: int = 30,
        max_retries: int = 2,
        response_format: dict | None = None,
        ctx: CallContext | None = None,
    ) -> str:
        """Send a chat completion request and return the response text."""
        ctx = ctx or CallContext(purpose=purpose)
        state = _CallState()
        request_text = " ".join(m.get("content", "") for m in messages)
        t0 = time.perf_counter()

        async def _attempt() -> str:
            return await self._do_call(
                messages,
                state,
                purpose,
                temperature,
                max_tokens,
                timeout,
                response_format,
            )

        try:
            content = await async_retry(_attempt, max_retries=max_retries, purpose=purpose)
            latency_ms = int((time.perf_counter() - t0) * 1000)
            self._log_worker.enqueue(
                purpose=purpose,
                user_id=ctx.user_id,
                record_id=ctx.record_id,
                case_id=ctx.case_id,
                model=state.model,
                temperature=temperature,
                max_tokens=max_tokens,
                latency_ms=latency_ms,
                status="success",
                request_text=request_text,
                response_text=content,
                usage=None,
                meta=ctx.log_meta,
                config_id=state.config_id,
                provider_name=state.provider_name,
                key_price_input=state.price_input,
                key_price_output=state.price_output,
            )
            est_tokens = int((len(request_text) + len(content)) / 1.5)
            est_cost = est_tokens / 1_000_000 * 1.5
            self._record_metrics(status="success", tokens=est_tokens, cost=est_cost, latency_ms=latency_ms)
            return content
        except Exception:
            latency_ms = int((time.perf_counter() - t0) * 1000)
            self._log_worker.enqueue(
                purpose=purpose,
                user_id=ctx.user_id,
                record_id=ctx.record_id,
                case_id=ctx.case_id,
                model=state.model,
                temperature=temperature,
                max_tokens=max_tokens,
                latency_ms=latency_ms,
                status="failed",
                error_type="all_providers_failed",
                request_text=request_text,
                meta=ctx.log_meta,
                config_id=state.config_id,
                provider_name=state.provider_name,
            )
            self._record_metrics(status="error", tokens=0, cost=0.0, latency_ms=latency_ms)
            raise

    async def stream(
        self,
        messages: list[dict],
        *,
        purpose: str,
        temperature: float = 0.7,
        max_tokens: int = 512,
        timeout: int = 30,
        max_retries: int = 2,
        ctx: CallContext | None = None,
    ) -> AsyncIterator[str]:
        """Send a streaming chat completion and yield content chunks."""
        ctx = ctx or CallContext(purpose=purpose)
        request_text = " ".join(m.get("content", "") for m in messages)
        full_reply: list[str] = []
        t0 = time.perf_counter()
        state = _CallState()

        for attempt in range(max_retries + 1):
            state = _CallState()
            full_reply = []
            try:
                async for chunk in self._do_stream(
                    messages,
                    state,
                    purpose,
                    temperature,
                    max_tokens,
                    timeout,
                ):
                    full_reply.append(chunk)
                    yield chunk
                # success
                latency_ms = int((time.perf_counter() - t0) * 1000)
                total_text = "".join(full_reply)
                self._log_worker.enqueue(
                    purpose=purpose,
                    user_id=ctx.user_id,
                    record_id=ctx.record_id,
                    case_id=ctx.case_id,
                    model=state.model,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    latency_ms=latency_ms,
                    status="success",
                    request_text=request_text,
                    response_text=total_text,
                    usage=None,
                    meta=ctx.log_meta,
                    config_id=state.config_id,
                    provider_name=state.provider_name,
                    key_price_input=state.price_input,
                    key_price_output=state.price_output,
                )
                est_tokens = int((len(request_text) + len(total_text)) / 1.5)
                est_cost = est_tokens / 1_000_000 * 1.5
                self._record_metrics(status="success", tokens=est_tokens, cost=est_cost, latency_ms=latency_ms)
                return
            except (httpx.TimeoutException, httpx.ConnectError, httpx.RemoteProtocolError, httpx.ReadError):
                if attempt >= max_retries:
                    break
                await asyncio.sleep(backoff_delay(attempt))
            except httpx.HTTPStatusError as e:
                if e.response.status_code not in (429, 500, 502, 503, 504):
                    raise
                if attempt >= max_retries:
                    break
                await asyncio.sleep(backoff_delay(attempt))

        # all retries exhausted — fallback to non-streaming
        latency_ms = int((time.perf_counter() - t0) * 1000)
        if not full_reply:
            try:
                content = await self.call(
                    messages,
                    purpose=purpose,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    timeout=timeout,
                    max_retries=0,
                    ctx=ctx,
                )
                yield content
                return
            except Exception:
                log.warning("Stream fallback batch call also failed: purpose=%s", purpose)

        self._log_worker.enqueue(
            purpose=purpose,
            user_id=ctx.user_id,
            record_id=ctx.record_id,
            case_id=ctx.case_id,
            model=state.model,
            temperature=temperature,
            max_tokens=max_tokens,
            latency_ms=latency_ms,
            status="failed",
            error_type="all_providers_failed",
            request_text=request_text,
            meta=ctx.log_meta,
            config_id=state.config_id,
            provider_name=state.provider_name,
        )
        self._record_metrics(status="error", tokens=0, cost=0.0, latency_ms=latency_ms)
        raise NoProviderAvailable(f"purpose={purpose}")

    async def call_json(
        self,
        messages: list[dict],
        *,
        purpose: str,
        temperature: float = 0.3,
        max_tokens: int = 2048,
        timeout: int = 120,
        max_retries: int = 3,
        response_format: dict | None = None,
        ctx: CallContext | None = None,
    ) -> dict:
        """call() + safe JSON parse. Raises LLMParseError on failure."""
        text = await self.call(
            messages,
            purpose=purpose,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=timeout,
            max_retries=max_retries,
            response_format=response_format,
            ctx=ctx,
        )
        try:
            return _safe_parse_json(text)
        except (json.JSONDecodeError, ValueError) as e:
            raise LLMParseError(f"purpose={purpose}: {e!s}") from e

    # ── Internal ──

    async def _select_config(self, purpose: str) -> _CallState:
        """Select a profile from the router and build call state."""
        config = self._router.select(purpose)
        api_key = self._router.get_decrypted_key(config)

        state = _CallState()
        state._config = config
        state.api_key = api_key
        state.model = config.model
        state.config_id = config.id

        if hasattr(config, "secret") and config.secret is not None:
            state.provider_name = self._infer_provider(config.secret.base_url)
            state.base_url = config.secret.base_url
            state.price_input = float(config.secret.price_input_per_1m or 0)
            state.price_output = float(config.secret.price_output_per_1m or 0)
        else:
            state.provider_name = self._infer_provider(getattr(config, "base_url", ""))
            state.base_url = getattr(config, "base_url", "")
            state.price_input = float(getattr(config, "price_input_per_1m", 0) or 0)
            state.price_output = float(getattr(config, "price_output_per_1m", 0) or 0)

        return state

    async def _do_call(
        self,
        messages,
        state,
        purpose,
        temperature,
        max_tokens,
        timeout,
        response_format,
    ) -> str:
        """Single HTTP call attempt."""
        new_state = await self._select_config(purpose)
        self._copy_state(new_state, state)

        payload: dict = {
            "model": state.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if response_format:
            payload["response_format"] = response_format

        async with asyncio.timeout(timeout + 10):
            async with self._sem:
                resp = await self._http.post(
                    f"{state.base_url}/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {state.api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                    timeout=httpx.Timeout(timeout, connect=15.0),
                )
        resp.raise_for_status()
        data = resp.json()
        content = data["choices"][0]["message"]["content"]

        usage = data.get("usage", {})
        total_tokens = usage.get("total_tokens", 0) or 0
        await self._router.report_result(
            state._config,
            success=True,
            tokens=total_tokens,
            latency_ms=0,
            error=None,
        )
        return content

    async def _do_stream(
        self,
        messages,
        state,
        purpose,
        temperature,
        max_tokens,
        timeout,
    ) -> AsyncIterator[str]:
        """Single streaming HTTP attempt — yields content chunks."""
        new_state = await self._select_config(purpose)
        self._copy_state(new_state, state)

        payload = {
            "model": state.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }

        async with asyncio.timeout(timeout + 10):
            async with self._sem:
                async with self._http.stream(
                    "POST",
                    f"{state.base_url}/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {state.api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                    timeout=httpx.Timeout(timeout, connect=15.0),
                ) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if line.startswith("data: "):
                            data = line[6:]
                            if data == "[DONE]":
                                break
                            try:
                                obj = json.loads(data)
                                delta = obj["choices"][0].get("delta", {})
                                content = delta.get("content", "")
                                if content:
                                    yield content
                            except (json.JSONDecodeError, KeyError, IndexError):
                                pass

    @staticmethod
    def _copy_state(src: _CallState, dst: _CallState) -> None:
        dst._config = src._config
        dst.provider_name = src.provider_name
        dst.model = src.model
        dst.config_id = src.config_id
        dst.api_key = src.api_key
        dst.base_url = src.base_url
        dst.price_input = src.price_input
        dst.price_output = src.price_output

    @staticmethod
    def _infer_provider(base_url: str) -> str:
        if not base_url:
            return "unknown"
        if "deepseek" in base_url:
            return "deepseek"
        if "openai" in base_url:
            return "openai"
        return base_url.rsplit("//", 1)[-1].split("/", 1)[0].split(".", 1)[0]
