import asyncio
import json
import random
import re
import time
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass

import httpx

from core.config import LLM_CONCURRENT_LIMIT


def _backoff(attempt: int) -> float:
    return min(2**attempt, 4) + random.uniform(0, 0.5)


class _SemaPool:
    def __init__(self):
        self._semaphore = asyncio.Semaphore(LLM_CONCURRENT_LIMIT)

    @asynccontextmanager
    async def acquire(self, timeout: float = 30):
        try:
            await asyncio.wait_for(self._semaphore.acquire(), timeout=timeout)
        except TimeoutError:
            raise RuntimeError("LLM 服务繁忙，请稍后重试") from None
        try:
            yield
        finally:
            self._semaphore.release()


_sema_pool = _SemaPool()

_RETRYABLE_STATUSES = {429, 500, 502, 503, 504}
_RETRYABLE_EXCEPTIONS = (httpx.TimeoutException, httpx.ConnectError, httpx.RemoteProtocolError, httpx.ReadError)


@dataclass
class _CallContext:
    purpose: str
    user_id: int | None = None
    record_id: int | None = None
    case_id: int | None = None
    log_meta: dict | None = None
    temperature: float = 0.7
    max_tokens: int = 512
    request_text: str = ""
    provider_name: str = "unknown"
    model: str = "unknown"
    config_id: int | None = None

    def apply_config(self, config) -> None:
        from services.provider_catalog import infer_provider_name

        if hasattr(config, "secret") and config.secret:
            base_url = config.secret.base_url
            self.provider_name = infer_provider_name(base_url) if base_url else config.secret.label
        else:
            self.provider_name = infer_provider_name(config.base_url) if config.base_url else config.label
        self.model = config.model
        self.config_id = config.id

    def pricing(self, config) -> tuple[float, float]:
        if hasattr(config, "secret") and config.secret:
            return (float(config.secret.price_input_per_1m or 0), float(config.secret.price_output_per_1m or 0))
        return (float(config.price_input_per_1m or 0), float(config.price_output_per_1m or 0))

    def log_success(
        self,
        log_worker,
        latency_ms: int,
        response_text: str,
        usage: dict | None = None,
        price_input: float = 0,
        price_output: float = 0,
    ):
        log_worker.enqueue(
            purpose=self.purpose,
            user_id=self.user_id,
            record_id=self.record_id,
            case_id=self.case_id,
            model=self.model,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
            latency_ms=latency_ms,
            status="success",
            request_text=self.request_text,
            response_text=response_text,
            usage=usage,
            meta=self.log_meta,
            api_key_id=None,
            config_id=self.config_id,
            provider_name=self.provider_name,
            key_price_input=price_input,
            key_price_output=price_output,
        )

    def log_failure(self, log_worker, latency_ms: int, error_type: str, error_message: str | None):
        log_worker.enqueue(
            purpose=self.purpose,
            user_id=self.user_id,
            record_id=self.record_id,
            case_id=self.case_id,
            model=self.model,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
            latency_ms=latency_ms,
            status="failed",
            error_type=error_type,
            error_message=error_message,
            request_text=self.request_text,
            meta=self.log_meta,
            api_key_id=None,
            config_id=self.config_id,
            provider_name=self.provider_name,
        )


def _get_base_url(config) -> str:
    if hasattr(config, "secret") and config.secret:
        return config.secret.base_url
    return config.base_url or ""


async def call_llm(
    messages: list,
    *,
    temperature: float = 0.7,
    max_tokens: int = 512,
    timeout: int = 30,
    max_retries: int = 2,
    purpose: str = "other",
    user_id: int | None = None,
    record_id: int | None = None,
    case_id: int | None = None,
    log_meta: dict | None = None,
    client: httpx.AsyncClient,
    router,
    log_worker,
    response_format: dict | None = None,
) -> str:
    ctx = _CallContext(
        purpose=purpose,
        user_id=user_id,
        record_id=record_id,
        case_id=case_id,
        log_meta=log_meta,
        temperature=temperature,
        max_tokens=max_tokens,
        request_text=" ".join(m.get("content", "") for m in messages),
    )

    last_error = None
    latency_ms = 0
    t0 = time.perf_counter()

    for attempt in range(max_retries + 2):
        try:
            config = router.select(purpose)
            api_key = router.get_decrypted_key(config)
            ctx.apply_config(config)

            payload = {
                "model": ctx.model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
            if response_format:
                payload["response_format"] = response_format

            async with _sema_pool.acquire():
                resp = await client.post(
                    f"{_get_base_url(config)}/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                    timeout=httpx.Timeout(timeout, connect=15.0),
                )
            latency_ms = int((time.perf_counter() - t0) * 1000)

            if resp.status_code == 429:
                await router.report_result(config, success=False, tokens=0, latency_ms=0, error=f"HTTP 429: {resp.text[:200]}")
                last_error = "HTTP 429"
                if attempt < max_retries + 1:
                    await asyncio.sleep(_backoff(attempt))
                continue

            if resp.status_code in _RETRYABLE_STATUSES:
                last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
                await router.report_result(config, success=False, tokens=0, latency_ms=0, error=last_error)
                if attempt < max_retries:
                    await asyncio.sleep(_backoff(attempt))
                continue

            resp.raise_for_status()
            try:
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
            except (json.JSONDecodeError, KeyError, IndexError) as e:
                last_error = f"Invalid response: {e}"
                await router.report_result(config, success=False, tokens=0, latency_ms=0, error=last_error)
                if attempt < max_retries:
                    await asyncio.sleep(_backoff(attempt))
                continue

            usage = data.get("usage", {})
            total_tokens = usage.get("total_tokens", 0) or len(content) // 2

            await router.report_result(config, success=True, tokens=total_tokens, latency_ms=latency_ms, error=None)

            pi, po = ctx.pricing(config)
            ctx.log_success(log_worker, latency_ms, content, usage, price_input=pi, price_output=po)
            return content

        except _RETRYABLE_EXCEPTIONS as e:
            error_str = f"{type(e).__name__}: {str(e)[:200]}"
            if ctx.config_id:
                await router.report_result(config, success=False, tokens=0, latency_ms=0, error=error_str)
            last_error = error_str
            if attempt < max_retries + 1:
                await asyncio.sleep(_backoff(attempt))
        except RuntimeError as e:
            if "可用" in str(e):
                raise
            last_error = str(e)[:200]
            if ctx.config_id:
                await router.report_result(config, success=False, tokens=0, latency_ms=0, error=last_error)
            if attempt < max_retries:
                await asyncio.sleep(1)
            continue

    latency_ms = int((time.perf_counter() - t0) * 1000)
    ctx.log_failure(log_worker, latency_ms, "all_providers_failed", last_error)
    raise RuntimeError(f"LLM调用失败（所有 provider 不可用）: {last_error}")


async def call_llm_stream(
    messages: list,
    *,
    temperature: float = 0.7,
    max_tokens: int = 512,
    timeout: int = 30,
    max_retries: int = 2,
    purpose: str = "other",
    user_id: int | None = None,
    record_id: int | None = None,
    case_id: int | None = None,
    log_meta: dict | None = None,
    client: httpx.AsyncClient,
    router,
    log_worker,
):
    ctx = _CallContext(
        purpose=purpose,
        user_id=user_id,
        record_id=record_id,
        case_id=case_id,
        log_meta=log_meta,
        temperature=temperature,
        max_tokens=max_tokens,
        request_text=" ".join(m.get("content", "") for m in messages),
    )

    last_error = None
    t0 = time.perf_counter()
    full_reply = ""

    for attempt in range(max_retries + 2):
        try:
            config = router.select(purpose)
            api_key = router.get_decrypted_key(config)
            ctx.apply_config(config)
        except RuntimeError as e:
            if "可用" in str(e):
                raise
            last_error = str(e)[:200]
            if attempt < max_retries + 1:
                await asyncio.sleep(1)
            continue
        except Exception as e:
            last_error = f"{type(e).__name__}: {str(e)[:200]}"
            if attempt < max_retries + 1:
                await asyncio.sleep(1)
            continue

        payload = {
            "model": ctx.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }

        try:
            async with (
                _sema_pool.acquire(),
                client.stream(
                    "POST",
                    f"{_get_base_url(config)}/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                    timeout=httpx.Timeout(timeout, connect=15.0),
                ) as resp,
            ):
                if resp.status_code != 200:
                    body = await resp.aread()
                    status_text = body.decode(errors="replace")[:200]
                    if resp.status_code == 429:
                        await router.report_result(config, success=False, tokens=0, latency_ms=0, error=f"HTTP 429: {status_text}")
                        last_error = "HTTP 429"
                    elif resp.status_code in _RETRYABLE_STATUSES:
                        last_error = f"HTTP {resp.status_code}: {status_text}"
                        await router.report_result(config, success=False, tokens=0, latency_ms=0, error=last_error)
                    else:
                        last_error = f"HTTP {resp.status_code}: {status_text}"
                    if attempt < max_retries + 1:
                        await asyncio.sleep(_backoff(attempt))
                    continue
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
                                full_reply += content
                                yield content
                        except json.JSONDecodeError:
                            pass

            latency_ms = int((time.perf_counter() - t0) * 1000)
            total_tokens = len(full_reply) // 2
            await router.report_result(config, success=True, tokens=total_tokens, latency_ms=latency_ms, error=None)
            pi, po = ctx.pricing(config)
            ctx.log_success(log_worker, latency_ms, full_reply, price_input=pi, price_output=po)
            return

        except _RETRYABLE_EXCEPTIONS as e:
            error_str = f"{type(e).__name__}: {str(e)[:200]}"
            await router.report_result(config, success=False, tokens=0, latency_ms=0, error=error_str)
            last_error = error_str
            if attempt < max_retries + 1:
                await asyncio.sleep(_backoff(attempt))
        except Exception as e:
            error_str = f"{type(e).__name__}: {str(e)[:200]}"
            await router.report_result(config, success=False, tokens=0, latency_ms=0, error=error_str)
            last_error = error_str
            if attempt < max_retries + 1:
                await asyncio.sleep(1)

    latency_ms = int((time.perf_counter() - t0) * 1000)
    if not full_reply:
        content = await call_llm(
            messages,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=timeout,
            max_retries=1,
            purpose=purpose,
            user_id=user_id,
            record_id=record_id,
            case_id=case_id,
            log_meta=log_meta,
            client=client,
            router=router,
            log_worker=log_worker,
        )
        yield content
        return
    ctx.log_failure(log_worker, latency_ms, "all_providers_failed", last_error)
    raise RuntimeError(f"LLM流式调用失败（所有 provider 不可用）: {last_error}")


def _safe_parse_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*\n?", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\n?\s*```\s*$", "", text)
    text = text.strip()

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        text = text[start : end + 1]

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    try:
        cleaned = re.sub(r",\s*}", "}", text)
        cleaned = re.sub(r",\s*]", "]", cleaned)
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    try:
        repaired = _repair_truncated_json(text)
        if repaired:
            return json.loads(repaired)
    except json.JSONDecodeError:
        pass

    result = {
        "strengths": [],
        "weaknesses": [],
        "missed_content": [],
        "suggestions": "",
        "detail_scores": {},
    }
    for field in ["total_score", "strengths", "weaknesses", "missed_content", "suggestions", "detail_scores"]:
        if field == "total_score":
            m = re.search(r'"total_score"\s*:\s*(-?\d+(?:\.\d+)?)', text)
            if m:
                val = m.group(1)
                result["total_score"] = float(val) if "." in val else int(val)
        elif field == "suggestions":
            m = re.search(r'"suggestions"\s*:\s*"((?:[^"\\]|\\.)*)"', text)
            if m:
                result["suggestions"] = m.group(1)
        elif field in ("strengths", "weaknesses", "missed_content"):
            m = re.search(rf'"{field}"\s*:\s*\[([^\]]*)\]', text)
            if m:
                items = re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(1))
                result[field] = items
        elif field == "detail_scores":
            m = re.search(r'"detail_scores"\s*:\s*(\{)', text, re.DOTALL)
            if m:
                start_pos = m.start(1)
                depth = 0
                end_pos = start_pos
                for i, ch in enumerate(text[start_pos:], start=start_pos):
                    if ch == "{":
                        depth += 1
                    elif ch == "}":
                        depth -= 1
                        if depth == 0:
                            end_pos = i + 1
                            break
                if end_pos > start_pos:
                    with suppress(json.JSONDecodeError):
                        result["detail_scores"] = json.loads(text[start_pos:end_pos])

    if not result or ("total_score" not in result and "detail_scores" not in result):
        raise ValueError(f"无法解析LLM返回的JSON: {text[:500]}")
    return result


def _repair_truncated_json(text: str) -> str | None:
    if not text or not text.strip().startswith("{"):
        return None
    if text.rstrip().endswith('"'):
        pass
    else:
        last_quote = text.rfind('"')
        if last_quote > len(text) // 2:
            text = text[: last_quote + 1]
    open_braces = text.count("{") - text.count("}")
    open_brackets = text.count("[") - text.count("]")
    in_string = False
    for i, ch in enumerate(text):
        if ch == '"' and (i == 0 or text[i - 1] != "\\"):
            in_string = not in_string
    if in_string:
        text += '"'
    text += "]" * open_brackets
    text += "}" * open_braces
    if open_braces > 0 or open_brackets > 0:
        return text
    return None


async def call_llm_json(
    messages: list,
    *,
    temperature: float = 0.3,
    max_tokens: int = 2048,
    timeout: int = 120,
    max_retries: int = 3,
    purpose: str = "other",
    user_id: int | None = None,
    record_id: int | None = None,
    case_id: int | None = None,
    log_meta: dict | None = None,
    client: httpx.AsyncClient,
    router,
    log_worker,
) -> dict:
    response_text = await call_llm(
        messages,
        temperature=temperature,
        max_tokens=max_tokens,
        timeout=timeout,
        max_retries=max_retries,
        purpose=purpose,
        user_id=user_id,
        record_id=record_id,
        case_id=case_id,
        log_meta=log_meta,
        client=client,
        router=router,
        log_worker=log_worker,
    )
    return _safe_parse_json(response_text)
