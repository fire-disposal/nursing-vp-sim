"""LLMClient — unified entry point for LLM API calls.

Consolidates call_llm / call_llm_stream / call_llm_json from
the old services/llm/service.py into a single class with shared
retry, rate-limiting, and logging logic.
"""

import asyncio
import json
import logging
import os
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field

import httpx

from core.exceptions import LLMParseError, NoProviderAvailable
from infrastructure.llm.circuit import async_retry, backoff_delay

from .logging import LogWorker
from .parsing import _safe_parse_json
from .router import ProfileRouter, _SyntheticConfig

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
    provider_name: str = "deepseek"
    model: str = "unknown"
    config_id: int | None = None
    api_key: str = ""
    base_url: str = ""
    price_input: float = 0.0
    price_output: float = 0.0
    usage: dict | None = None
    cache_hit_tokens: int = 0
    cache_miss_tokens: int = 0


@dataclass
class _CallResult:
    """Result of a single LLM HTTP call — content and optionally tool_calls."""

    content: str = ""
    tool_calls: list[dict] = field(default_factory=list)
    usage: dict = field(default_factory=dict)
    cache_hit_tokens: int = 0
    cache_miss_tokens: int = 0


class LLMClient:
    """Unified LLM caller with retry, concurrency limiting, and logging."""

    def __init__(
        self,
        http: httpx.AsyncClient,
        router: ProfileRouter,
        log_worker: LogWorker,
        metrics=None,
    ):
        self._http = http
        self._router = router
        self._log_worker = log_worker
        self._metrics = metrics
        # Per-purpose semaphores — sourced from core/llm_profile.py
        from core.llm_profile import PROFILES

        _divisor = max(1, int(os.getenv("LLM_WORKER_COUNT", "1")))
        self._semaphores: dict[str, asyncio.Semaphore] = {
            p: asyncio.Semaphore(max(1, pf.semaphore // _divisor)) for p, pf in PROFILES.items()
        }
        self._default_sem = asyncio.Semaphore(max(1, 50 // _divisor))

    def _sem_for(self, purpose: str) -> asyncio.Semaphore:
        for prefix in sorted(self._semaphores, key=len, reverse=True):
            if purpose.startswith(prefix):
                return self._semaphores[prefix]
        return self._default_sem

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

        async def _attempt() -> _CallResult:
            return await self._do_call(
                messages,
                state,
                purpose,
                temperature,
                max_tokens,
                timeout,
                response_format,
                ctx,
            )

        try:
            result = await async_retry(_attempt, max_retries=max_retries, purpose=purpose)
            content = result.content
            latency_ms = int((time.perf_counter() - t0) * 1000)
            usage = result.usage or {}
            prompt_tokens = usage.get("prompt_tokens", 0) or 0
            completion_tokens = usage.get("completion_tokens", 0) or 0
            total_tokens = usage.get("total_tokens", 0) or prompt_tokens + completion_tokens
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
                usage=usage or None,
                meta=ctx.log_meta,
                config_id=state.config_id,
                provider_name=state.provider_name,
                key_price_input=state.price_input,
                key_price_output=state.price_output,
                cache_hit_tokens=result.cache_hit_tokens,
                cache_miss_tokens=result.cache_miss_tokens,
            )
            from infrastructure.llm.token_counter import estimate_cost_cny

            actual_cost = estimate_cost_cny(
                prompt_tokens or 0,
                completion_tokens or 0,
                price_input=state.price_input,
                price_output=state.price_output,
                model=state.model,
            )
            self._record_metrics(status="success", tokens=total_tokens, cost=actual_cost, latency_ms=latency_ms)
            return content
        except Exception:
            latency_ms = int((time.perf_counter() - t0) * 1000)
            log.exception("LLM call failed: purpose=%s latency=%dms", purpose, latency_ms)
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
                key_price_input=state.price_input,
                key_price_output=state.price_output,
            )
            self._record_metrics(status="error", tokens=0, cost=0.0, latency_ms=latency_ms)
            raise

    async def call_with_tools(
        self,
        messages: list[dict],
        tools: list[dict],
        tool_handlers: dict[str, Callable],
        *,
        purpose: str,
        temperature: float = 0.7,
        max_tokens: int = 512,
        timeout: int = 30,
        max_retries: int = 2,
        max_tool_rounds: int = 5,
        ctx: CallContext | None = None,
    ) -> str:
        """Call LLM with tools — the model may call tools and continue the conversation.

        tool_handlers: dict of {function_name: async handler(arguments_dict) -> str}
        Returns final content after tool loop completes.
        """
        ctx = ctx or CallContext(purpose=purpose)
        state = _CallState()
        request_text = " ".join(m.get("content", "") for m in messages)
        t0 = time.perf_counter()

        msgs = list(messages)  # mutable copy
        tool_rounds = 0
        cumulative_usage: dict = {}
        cumulative_cache_hit = 0
        cumulative_cache_miss = 0

        while tool_rounds < max_tool_rounds:
            tool_rounds += 1

            async def _attempt() -> _CallResult:
                return await self._do_call(
                    msgs, state, purpose, temperature, max_tokens, timeout, None, ctx, tools=tools
                )

            try:
                result = await async_retry(_attempt, max_retries=max_retries, purpose=purpose)
            except Exception as e:
                latency_ms = int((time.perf_counter() - t0) * 1000)
                log.exception("LLM tool call failed: purpose=%s round=%d", purpose, tool_rounds)
                self._log_worker.enqueue(
                    purpose=purpose,
                    model="",
                    status="error",
                    error_type=type(e).__name__,
                    error_message=str(e),
                    latency_ms=latency_ms,
                    ctx=ctx,
                )
                raise

            if result.tool_calls:
                # Accumulate usage across tool rounds
                for k, v in (result.usage or {}).items():
                    if isinstance(v, (int, float)):
                        cumulative_usage[k] = cumulative_usage.get(k, 0) + v
                cumulative_cache_hit += result.cache_hit_tokens or 0
                cumulative_cache_miss += result.cache_miss_tokens or 0

                msgs.append(
                    {
                        "role": "assistant",
                        "content": result.content or "",
                        "tool_calls": result.tool_calls,
                    }
                )
                has_error = False
                for tc in result.tool_calls:
                    func_name = tc["function"]["name"]
                    try:
                        args = json.loads(tc["function"]["arguments"])
                    except json.JSONDecodeError:
                        log.warning(
                            "Tool args parse failed for %s: %s", func_name, tc["function"].get("arguments", "")[:200]
                        )
                        args = {}
                    handler = tool_handlers.get(func_name)
                    if handler:
                        try:
                            tool_result = await handler(args)
                            if not isinstance(tool_result, str):
                                tool_result = json.dumps(tool_result, ensure_ascii=False)
                        except Exception:
                            log.exception("Tool handler failed: %s", func_name)
                            tool_result = json.dumps({"error": f"Tool '{func_name}' execution failed"})
                    else:
                        log.warning("Unknown tool called: %s", func_name)
                        tool_result = json.dumps({"error": f"Unknown tool: '{func_name}'"})
                        has_error = True
                    msgs.append(
                        {
                            "role": "tool",
                            "tool_call_id": tc["id"],
                            "content": tool_result,
                        }
                    )
                if has_error:
                    break  # Don't loop on unknown tools
                continue

            # No tool_calls — final response
            content = result.content or ""
            latency_ms = int((time.perf_counter() - t0) * 1000)
            # Merge final round usage into cumulative
            for k, v in (result.usage or {}).items():
                if isinstance(v, (int, float)):
                    cumulative_usage[k] = cumulative_usage.get(k, 0) + v
            cumulative_cache_hit += result.cache_hit_tokens or 0
            cumulative_cache_miss += result.cache_miss_tokens or 0
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
                usage=cumulative_usage or None,
                meta=ctx.log_meta,
                config_id=state.config_id,
                provider_name=state.provider_name,
                key_price_input=state.price_input,
                key_price_output=state.price_output,
                cache_hit_tokens=cumulative_cache_hit,
                cache_miss_tokens=cumulative_cache_miss,
            )
            return content

        # Exhausted max_tool_rounds — force final response
        msgs.append({"role": "user", "content": "请根据已检索到的资料，直接回答最初的问题。"})
        return await self.call(
            msgs,
            purpose=purpose,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=timeout,
            max_retries=0,
            ctx=ctx,
        )

    async def stream(
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
        on_reasoning: Callable[[str], Awaitable[None]] | None = None,
        enable_thinking: bool = False,
    ) -> AsyncIterator[str]:
        """Send a streaming chat completion and yield content chunks.

        If *on_reasoning* is provided, reasoning_content chunks are passed
        to it instead of being yielded.  If *enable_thinking* is True,
        reasoning_effort=high and thinking={type:enabled} are added to the
        request body (DeepSeek thinking mode).
        """
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
                    response_format,
                    ctx,
                    on_reasoning=on_reasoning,
                    enable_thinking=enable_thinking,
                ):
                    full_reply.append(chunk)
                    yield chunk
                # success
                latency_ms = int((time.perf_counter() - t0) * 1000)
                total_text = "".join(full_reply)
                usage = state.usage or {}
                prompt_tokens = usage.get("prompt_tokens")
                completion_tokens = usage.get("completion_tokens")
                if prompt_tokens is None or completion_tokens is None:
                    from infrastructure.llm.token_counter import estimate_tokens

                    prompt_tokens = estimate_tokens(request_text or "")
                    completion_tokens = estimate_tokens(total_text or "")
                else:
                    prompt_tokens = prompt_tokens or 0
                    completion_tokens = completion_tokens or 0
                total_tokens = usage.get("total_tokens") or (prompt_tokens + completion_tokens)

                await self._router.report_result(
                    state._config,
                    success=True,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    total_tokens=total_tokens,
                    latency_ms=latency_ms,
                    error=None,
                )

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
                    usage=usage or None,
                    meta=ctx.log_meta,
                    config_id=state.config_id,
                    provider_name=state.provider_name,
                    key_price_input=state.price_input,
                    key_price_output=state.price_output,
                )
                from infrastructure.llm.token_counter import estimate_cost_cny

                actual_cost = estimate_cost_cny(
                    prompt_tokens or 0,
                    completion_tokens or 0,
                    price_input=state.price_input,
                    price_output=state.price_output,
                    model=state.model,
                )
                self._record_metrics(status="success", tokens=total_tokens, cost=actual_cost, latency_ms=latency_ms)
                return
            except (httpx.TimeoutException, httpx.ConnectError, httpx.RemoteProtocolError, httpx.ReadError) as e:
                await self._router.report_result(state._config, success=False, error=str(e))
                if attempt >= max_retries:
                    break
                await asyncio.sleep(backoff_delay(attempt))
            except httpx.HTTPStatusError as e:
                await self._router.report_result(state._config, success=False, error=str(e))
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
                log.exception("Stream fallback batch call also failed: purpose=%s", purpose)

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
            key_price_input=state.price_input,
            key_price_output=state.price_output,
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
        from cryptography.fernet import InvalidToken as FernetInvalidToken

        from core.llm_profile import get_model

        config = self._router.select(purpose)
        try:
            api_key = self._router.get_decrypted_key(config)
        except FernetInvalidToken:
            from core.config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL

            if DEEPSEEK_API_KEY and DEEPSEEK_API_KEY.startswith("sk-"):
                log.warning("DB 密钥解密失败（FERNET_KEY 不匹配），回退到 env DEEPSEEK_API_KEY")
                config = _SyntheticConfig(
                    label="DeepSeek (env)",
                    base_url=DEEPSEEK_BASE_URL,
                    model=get_model(purpose),
                    raw_key=DEEPSEEK_API_KEY,
                )
                api_key = DEEPSEEK_API_KEY
            else:
                raise NoProviderAvailable(
                    f"密钥解密失败：FERNET_KEY 与数据库不匹配，且未配置 DEEPSEEK_API_KEY。purpose={purpose}"
                )

        state = _CallState()
        state._config = config
        state.api_key = api_key
        state.model = get_model(purpose)
        state.config_id = config.id

        if hasattr(config, "secret") and config.secret is not None:
            state.provider_name = "deepseek"
            state.base_url = config.secret.base_url
            state.price_input = float(config.secret.price_input_per_1m or 0)
            state.price_output = float(config.secret.price_output_per_1m or 0)
        else:
            state.provider_name = "deepseek"
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
        ctx,
        tools=None,
    ) -> _CallResult:
        """Single HTTP call attempt. Returns _CallResult with content + optional tool_calls."""
        new_state = await self._select_config(purpose)
        self._copy_state(new_state, state)

        payload: dict = {
            "model": state.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if ctx and ctx.record_id:
            payload["user"] = str(ctx.record_id)
        if response_format:
            payload["response_format"] = response_format
        if tools:
            payload["tools"] = tools

        t0 = time.perf_counter()
        try:
            async with asyncio.timeout(timeout + 10):
                async with self._sem_for(purpose):
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
            msg = data["choices"][0]["message"]
            content = msg.get("content", "") or ""
            tool_calls = msg.get("tool_calls") or []
            latency_ms = int((time.perf_counter() - t0) * 1000)

            usage = data.get("usage", {})
            state.usage = usage
            state.cache_hit_tokens = usage.get("prompt_cache_hit_tokens", 0) or 0
            state.cache_miss_tokens = usage.get("prompt_cache_miss_tokens", 0) or 0
            prompt_tokens = usage.get("prompt_tokens", 0) or 0
            completion_tokens = usage.get("completion_tokens", 0) or 0
            total_tokens = usage.get("total_tokens", 0) or prompt_tokens + completion_tokens
            await self._router.report_result(
                state._config,
                success=True,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                latency_ms=latency_ms,
                error=None,
            )
            return _CallResult(
                content=content,
                tool_calls=tool_calls,
                usage=usage,
                cache_hit_tokens=state.cache_hit_tokens,
                cache_miss_tokens=state.cache_miss_tokens,
            )
        except Exception as e:
            log.error("_do_call HTTP/post-parse failure: purpose=%s model=%s error=%s", purpose, state.model, e)
            await self._router.report_result(
                state._config,
                success=False,
                error=str(e),
            )
            raise

    async def _do_stream(
        self,
        messages,
        state,
        purpose,
        temperature,
        max_tokens,
        timeout,
        response_format,
        ctx,
        *,
        on_reasoning=None,
        enable_thinking=False,
    ) -> AsyncIterator[str]:
        """Single streaming HTTP attempt — yields content chunks.

        If *on_reasoning* is set, reasoning_content is passed to it instead
        of being yielded.  If *enable_thinking* is True, reasoning_effort
        and thinking headers are added (DeepSeek thinking mode).
        """
        new_state = await self._select_config(purpose)
        self._copy_state(new_state, state)

        payload = {
            "model": state.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if enable_thinking:
            payload["reasoning_effort"] = "high"
            payload["thinking"] = {"type": "enabled"}
        if response_format:
            payload["response_format"] = response_format
        if ctx and ctx.record_id:
            payload["user"] = str(ctx.record_id)

        try:
            async with asyncio.timeout(timeout + 10):
                async with self._sem_for(purpose):
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
                        last_obj = None
                        async for line in resp.aiter_lines():
                            if line.startswith("data: "):
                                raw = line[6:]
                                if raw == "[DONE]":
                                    break
                                try:
                                    obj = json.loads(raw)
                                    last_obj = obj
                                    delta = obj["choices"][0].get("delta", {})
                                    reasoning = delta.get("reasoning_content", "")
                                    if reasoning and on_reasoning:
                                        await on_reasoning(reasoning)
                                    content = delta.get("content", "") or ""
                                    if content:
                                        yield content
                                except (json.JSONDecodeError, KeyError, IndexError):
                                    log.debug("SSE chunk parse skipped: %s", raw[:120])
                        # Extract usage from last SSE chunk (some providers include it)
                        if last_obj and "usage" in last_obj:
                            state.usage = last_obj["usage"]
        except Exception as e:
            log.error("_do_stream failure: purpose=%s model=%s error=%s", purpose, state.model, e)
            await self._router.report_result(
                state._config,
                success=False,
                error=str(e),
            )
            raise

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
        dst.usage = src.usage
