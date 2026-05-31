import asyncio
import json
import random
import re
import time
import httpx
from config import (
    LLM_MAX_RETRIES,
    LLM_CONCURRENT_LIMIT, LLM_CONNECTION_POOL_SIZE, LLM_CONNECTION_KEEPALIVE,
    LLM_CHAT_TIMEOUT, LLM_CHAT_MAX_TOKENS,
    LLM_SCORING_TIMEOUT, LLM_SCORING_MAX_TOKENS,
)

# 并发限流
_rate_limiter = asyncio.Semaphore(LLM_CONCURRENT_LIMIT)

# 可重试的 HTTP 状态码和异常类型
_RETRYABLE_STATUSES = {429, 500, 502, 503, 504}
_RETRYABLE_EXCEPTIONS = (httpx.TimeoutException, httpx.ConnectError,
                          httpx.RemoteProtocolError, httpx.ReadError)

# 模块级共享客户端 —— 使用 HTTP/2 多路复用，避免连接池问题
_shared_client: httpx.AsyncClient | None = None
_shared_client_lock = asyncio.Lock()


async def _get_client() -> httpx.AsyncClient:
    """延迟创建共享客户端"""
    global _shared_client
    if _shared_client is None:
        async with _shared_client_lock:
            if _shared_client is None:
                _shared_client = httpx.AsyncClient(
                    timeout=httpx.Timeout(60, connect=15.0),
                    limits=httpx.Limits(
                        max_connections=LLM_CONNECTION_POOL_SIZE,
                        max_keepalive_connections=LLM_CONNECTION_KEEPALIVE,
                        keepalive_expiry=30,
                    ),
                )
    return _shared_client


async def _reset_client():
    """连接异常时重建客户端"""
    global _shared_client
    async with _shared_client_lock:
        if _shared_client is not None:
            await _shared_client.aclose()
            _shared_client = None


async def call_llm(messages: list, temperature: float = 0.7, max_tokens: int = 512,
                   timeout: int = 30, max_retries: int = 2,
                   # 日志上下文（可选）
                   purpose: str = "other",
                   user_id: int | None = None,
                   record_id: int | None = None,
                   case_id: int | None = None,
                   log_meta: dict | None = None,
                   client: httpx.AsyncClient | None = None,
                   semaphore: asyncio.Semaphore | None = None,
                   ) -> str:
    """通过 LLMRouter 选择 key/provider 调用 LLM API，返回文本回复。支持自动记录调用日志。"""
    from services.llm_router import get_router

    router = await get_router()

    used_key_id = None
    provider_name = "unknown"
    model = "unknown"
    last_error = None
    latency_ms = 0
    t0 = time.perf_counter()

    _client = client if client is not None else await _get_client()
    _sema = semaphore if semaphore is not None else _rate_limiter

    request_text = " ".join(m.get("content", "") for m in messages)

    for attempt in range(max_retries + 2):
        try:
            key, provider = router.select_key(purpose)
            api_key = router.get_decrypted_key(key.id)
            used_key_id = key.id
            provider_name = provider.name
            model = key.model or provider.default_model

            payload = {
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }

            async with _sema:
                resp = await _client.post(
                    f"{provider.base_url}/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                    timeout=httpx.Timeout(timeout, connect=15.0),
                )

            if resp.status_code == 429:
                router.report_result(key.id, success=False, tokens=0,
                                     latency_ms=0, error=f"HTTP 429: {resp.text[:200]}")
                last_error = "HTTP 429"
                if attempt < max_retries + 1:
                    delay = min(2 ** attempt, 4) + random.uniform(0, 0.5)
                    await asyncio.sleep(delay)
                continue

            if resp.status_code in _RETRYABLE_STATUSES:
                last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
                router.report_result(key.id, success=False, tokens=0, latency_ms=0, error=last_error)
                if attempt < max_retries:
                    delay = min(2 ** attempt, 4) + random.uniform(0, 0.5)
                    await asyncio.sleep(delay)
                continue

            resp.raise_for_status()
            try:
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
            except (json.JSONDecodeError, KeyError, IndexError) as e:
                last_error = f"Invalid response: {e}"
                router.report_result(key.id, success=False, tokens=0, latency_ms=0, error=last_error)
                if attempt < max_retries:
                    delay = min(2 ** attempt, 4) + random.uniform(0, 0.5)
                    await asyncio.sleep(delay)
                continue
            usage = data.get("usage", {})
            total_tokens = usage.get("total_tokens", 0) or len(content) // 2

            router.report_result(key.id, success=True, tokens=total_tokens,
                                 latency_ms=latency_ms, error=None)

            _log_llm_success(
                purpose=purpose, user_id=user_id, record_id=record_id,
                case_id=case_id, temperature=temperature, max_tokens=max_tokens,
                latency_ms=latency_ms, request_text=request_text,
                response_text=content, usage=usage,
                log_meta=log_meta, api_key_id=key.id, provider_name=provider_name, model=model,
                key_price_input=float(key.price_input_per_1m or 0),
                key_price_output=float(key.price_output_per_1m or 0),
            )
            return content

        except _RETRYABLE_EXCEPTIONS as e:
            error_str = f"{type(e).__name__}: {str(e)[:200]}"
            if used_key_id:
                router.report_result(used_key_id, success=False, tokens=0,
                                     latency_ms=0, error=error_str)
            last_error = error_str
            if isinstance(e, httpx.RemoteProtocolError):
                await _reset_client()
            if attempt < max_retries + 1:
                delay = min(2 ** attempt, 4) + random.uniform(0, 0.5)
                await asyncio.sleep(delay)
        except RuntimeError as e:
            if "无可用" in str(e):
                raise
            last_error = str(e)[:200]
            if used_key_id:
                router.report_result(used_key_id, success=False, tokens=0,
                                     latency_ms=0, error=last_error)
            if attempt < max_retries:
                await asyncio.sleep(1)
            continue

    latency_ms = int((time.perf_counter() - t0) * 1000)
    _log_llm_failure(
        purpose=purpose, user_id=user_id, record_id=record_id,
        case_id=case_id, temperature=temperature, max_tokens=max_tokens,
        latency_ms=latency_ms, request_text=request_text,
        error_type="all_providers_failed", error_message=last_error,
        log_meta=log_meta, api_key_id=used_key_id,
        provider_name=provider_name, model=model,
    )
    raise RuntimeError(f"LLM调用失败（所有 provider 不可用）: {last_error}")


def _log_llm_success(*, purpose, user_id, record_id, case_id, temperature,
                     max_tokens, latency_ms, request_text, response_text, usage, log_meta,
                     api_key_id=None, provider_name="deepseek", model="",
                     key_price_input=None, key_price_output=None):
    from services.llm_logging import enqueue_log
    enqueue_log(
        purpose=purpose, user_id=user_id, record_id=record_id, case_id=case_id,
        model=model, temperature=temperature, max_tokens=max_tokens,
        latency_ms=latency_ms, status="success",
        request_text=request_text, response_text=response_text, usage=usage,
        meta=log_meta, api_key_id=api_key_id, provider_name=provider_name,
        key_price_input=key_price_input, key_price_output=key_price_output,
    )


def _log_llm_failure(*, purpose, user_id, record_id, case_id, temperature,
                     max_tokens, latency_ms, request_text, error_type, error_message, log_meta,
                     api_key_id=None, provider_name="deepseek", model="",
                     key_price_input=None, key_price_output=None):
    from services.llm_logging import enqueue_log
    enqueue_log(
        purpose=purpose, user_id=user_id, record_id=record_id, case_id=case_id,
        model=model, temperature=temperature, max_tokens=max_tokens,
        latency_ms=latency_ms, status="failed",
        error_type=error_type, error_message=error_message,
        request_text=request_text, meta=log_meta,
        api_key_id=api_key_id, provider_name=provider_name,
        key_price_input=key_price_input, key_price_output=key_price_output,
    )


async def call_llm_stream(messages: list, temperature: float = 0.7, max_tokens: int = 512,
                          timeout: int = 30, max_retries: int = 2,
                          purpose: str = "other",
                          user_id: int | None = None,
                          record_id: int | None = None,
                          case_id: int | None = None,
                          log_meta: dict | None = None,
                          ):
    """通过 LLMRouter 选择 key/provider，流式返回文本块。支持重试与故障转移。"""
    from services.llm_router import get_router

    router = await get_router()
    request_text = " ".join(m.get("content", "") for m in messages)
    last_error = None
    latency_ms = 0
    used_key_id = None
    provider_name = "unknown"
    model_used = "unknown"
    t0 = time.perf_counter()

    for attempt in range(max_retries + 2):
        try:
            key, provider = router.select_key(purpose)
            api_key = router.get_decrypted_key(key.id)
            used_key_id = key.id
            provider_name = provider.name
            model_used = key.model or provider.default_model
        except RuntimeError as e:
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
            "model": model_used,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }

        client = await _get_client()
        full_reply = ""
        try:
            async with _rate_limiter:
                async with client.stream(
                    "POST",
                    f"{provider.base_url}/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                    timeout=httpx.Timeout(timeout, connect=15.0),
                ) as resp:
                    if resp.status_code != 200:
                        body = await resp.aread()
                        status_text = body.decode(errors="replace")[:200]
                        if resp.status_code == 429:
                            router.report_result(key.id, success=False, tokens=0,
                                                 latency_ms=0, error=f"HTTP 429: {status_text}")
                            last_error = "HTTP 429"
                        elif resp.status_code in _RETRYABLE_STATUSES:
                            last_error = f"HTTP {resp.status_code}: {status_text}"
                            router.report_result(key.id, success=False, tokens=0,
                                                 latency_ms=0, error=last_error)
                        else:
                            last_error = f"HTTP {resp.status_code}: {status_text}"
                        if attempt < max_retries + 1:
                            delay = min(2 ** attempt, 4) + random.uniform(0, 0.5)
                            await asyncio.sleep(delay)
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
            router.report_result(key.id, success=True, tokens=total_tokens,
                                 latency_ms=latency_ms, error=None)
            _log_llm_success(
                purpose=purpose, user_id=user_id, record_id=record_id,
                case_id=case_id, temperature=temperature, max_tokens=max_tokens,
                latency_ms=latency_ms, request_text=request_text,
                response_text=full_reply, usage=None,
                log_meta=log_meta, api_key_id=key.id,
                provider_name=provider_name, model=model_used,
                key_price_input=float(key.price_input_per_1m or 0),
                key_price_output=float(key.price_output_per_1m or 0),
            )
            return

        except _RETRYABLE_EXCEPTIONS as e:
            error_str = f"{type(e).__name__}: {str(e)[:200]}"
            router.report_result(key.id, success=False, tokens=0,
                                 latency_ms=0, error=error_str)
            last_error = error_str
            if isinstance(e, httpx.RemoteProtocolError):
                await _reset_client()
            if attempt < max_retries + 1:
                delay = min(2 ** attempt, 4) + random.uniform(0, 0.5)
                await asyncio.sleep(delay)
        except Exception as e:
            error_str = f"{type(e).__name__}: {str(e)[:200]}"
            router.report_result(key.id, success=False, tokens=0,
                                 latency_ms=0, error=error_str)
            last_error = error_str
            if attempt < max_retries + 1:
                await asyncio.sleep(1)

    latency_ms = int((time.perf_counter() - t0) * 1000)
    _log_llm_failure(
        purpose=purpose, user_id=user_id, record_id=record_id,
        case_id=case_id, temperature=temperature, max_tokens=max_tokens,
        latency_ms=latency_ms, request_text=request_text,
        error_type="all_providers_failed", error_message=last_error,
        log_meta=log_meta, api_key_id=used_key_id,
        provider_name=provider_name, model=model_used,
    )
    raise RuntimeError(f"LLM流式调用失败（所有 provider 不可用）: {last_error}")


def _safe_parse_json(text: str) -> dict:
    """安全解析 LLM 返回的 JSON，处理常见格式问题：markdown 围栏、尾部逗号、截断修复。"""
    text = text.strip()
    text = re.sub(r'^```(?:json)?\s*\n?', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\n?\s*```\s*$', '', text)
    text = text.strip()

    start = text.find('{')
    end = text.rfind('}')
    if start != -1 and end != -1 and end > start:
        text = text[start:end + 1]

    # 1. 标准解析
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 2. 移除尾部逗号后重试
    try:
        cleaned = re.sub(r',\s*}', '}', text)
        cleaned = re.sub(r',\s*]', ']', cleaned)
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # 3. 截断修复：补全缺失的 } ] " 
    try:
        repaired = _repair_truncated_json(text)
        if repaired:
            return json.loads(repaired)
    except json.JSONDecodeError:
        pass

    # 4. 最终降级：正则提取关键字段（给所有可选字段默认值）
    result = {
        "strengths": [],
        "weaknesses": [],
        "missed_content": [],
        "suggestions": "",
        "detail_scores": {},
    }
    for field in ["total_score", "strengths", "weaknesses", "missed_content",
                   "suggestions", "detail_scores"]:
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
                    if ch == '{':
                        depth += 1
                    elif ch == '}':
                        depth -= 1
                        if depth == 0:
                            end_pos = i + 1
                            break
                if end_pos > start_pos:
                    try:
                        result["detail_scores"] = json.loads(text[start_pos:end_pos])
                    except json.JSONDecodeError:
                        pass

    if not result or ("total_score" not in result and "detail_scores" not in result):
        raise ValueError(f"无法解析LLM返回的JSON: {text[:500]}")
    return result


def _repair_truncated_json(text: str) -> str | None:
    """尝试修复被截断的 JSON：补全未闭合的引号、大括号、方括号。"""
    if not text or not text.strip().startswith("{"):
        return None
    # 补全末尾截断的字符串值
    if text.rstrip().endswith('"'):
        pass  # 正常闭合
    else:
        last_quote = text.rfind('"')
        if last_quote > len(text) // 2:
            text = text[:last_quote + 1]
    # 计数括号差，补闭合
    open_braces = text.count("{") - text.count("}")
    open_brackets = text.count("[") - text.count("]")
    # 检查是否有未闭合的字符串（奇数个引号）
    in_string = False
    for i, ch in enumerate(text):
        if ch == '"' and (i == 0 or text[i - 1] != '\\'):
            in_string = not in_string
    if in_string:
        text += '"'
    text += "]" * open_brackets
    text += "}" * open_braces
    # 仅当补了括号才返回
    if open_braces > 0 or open_brackets > 0:
        return text
    return None


async def call_llm_json(messages: list, temperature: float = 0.3, max_tokens: int = 2048,
                        timeout: int = 120, max_retries: int = 3,
                        purpose: str = "other",
                        user_id: int | None = None,
                        record_id: int | None = None,
                        case_id: int | None = None,
                        log_meta: dict | None = None,
                        client: httpx.AsyncClient | None = None,
                        semaphore: asyncio.Semaphore | None = None,
                        ) -> dict:
    """调用 LLM API（通过 Router 路由），返回 JSON 结构化结果（容错解析），支持日志记录"""
    response_text = await call_llm(
        messages, temperature, max_tokens, timeout, max_retries,
        purpose=purpose, user_id=user_id, record_id=record_id,
        case_id=case_id, log_meta=log_meta,
        client=client, semaphore=semaphore,
    )
    return _safe_parse_json(response_text)
