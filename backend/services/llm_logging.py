"""LLM 调用日志服务 —— 异步队列批量写入，独立 DB session"""

import asyncio
import contextlib
import logging

from config import (
    LLM_COST_CURRENCY,
    LLM_PRICE_INPUT_PER_1M,
    LLM_PRICE_OUTPUT_PER_1M,
)
from database import SessionLocal

_logger = logging.getLogger(__name__)

_log_queue: asyncio.Queue[dict] | None = None
_worker_task: asyncio.Task | None = None


def _estimate_tokens(text: str) -> int:
    if not text:
        return 0
    return max(1, int(len(text) / 1.5))


def _estimate_cost(
    prompt_tokens: int, completion_tokens: int, price_input: float | None = None, price_output: float | None = None
) -> float:
    pi = price_input if price_input is not None else LLM_PRICE_INPUT_PER_1M
    po = price_output if price_output is not None else LLM_PRICE_OUTPUT_PER_1M
    if not pi and not po:
        return 0.0
    return prompt_tokens / 1_000_000 * pi + completion_tokens / 1_000_000 * po


def _build_entry(
    *,
    purpose,
    user_id,
    record_id,
    case_id,
    model,
    temperature,
    max_tokens,
    latency_ms,
    status,
    error_type,
    error_message,
    request_text,
    response_text,
    usage,
    meta,
    api_key_id=None,
    config_id=None,
    provider_name="deepseek",
    key_price_input=None,
    key_price_output=None,
):
    """构建 LLMCallLog 条目字典"""
    if usage:
        prompt_tokens = usage.get("prompt_tokens")
        completion_tokens = usage.get("completion_tokens")
        total_tokens = usage.get("total_tokens") or ((prompt_tokens or 0) + (completion_tokens or 0))
        token_estimated = 0 if total_tokens else 1
    else:
        prompt_tokens = _estimate_tokens(request_text)
        completion_tokens = _estimate_tokens(response_text)
        total_tokens = prompt_tokens + completion_tokens
        token_estimated = 1

    estimated_cost = _estimate_cost(prompt_tokens or 0, completion_tokens or 0, key_price_input, key_price_output)

    return {
        "user_id": user_id,
        "record_id": record_id,
        "case_id": case_id,
        "purpose": purpose,
        "provider_name": provider_name,
        "model": model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
        "token_estimated": token_estimated,
        "estimated_cost": round(estimated_cost, 6),
        "cost_currency": LLM_COST_CURRENCY,
        "latency_ms": latency_ms,
        "status": status,
        "error_type": error_type,
        "error_message": (error_message or "")[:500] if error_message else None,
        "request_chars": len(request_text) if request_text else None,
        "response_chars": len(response_text) if response_text else None,
        "request_text": request_text or None,
        "response_text": response_text or None,
        "meta": meta,
        "api_key_id": api_key_id,
        "config_id": config_id,
    }


async def start_worker():
    global _log_queue, _worker_task
    _log_queue = asyncio.Queue(maxsize=500)
    _worker_task = asyncio.create_task(_worker_loop())


async def stop_worker():
    global _log_queue, _worker_task
    if _worker_task:
        _worker_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _worker_task
        _worker_task = None
    _log_queue = None


async def _worker_loop():
    batch: list[dict] = []
    while True:
        try:
            item = await asyncio.wait_for(_log_queue.get(), timeout=2.0)
            batch.append(item)
        except TimeoutError:
            if batch:
                _flush_batch(batch)
                batch.clear()
            continue
        except asyncio.CancelledError:
            break

        if len(batch) >= 20:
            _flush_batch(batch)
            batch.clear()

    while not _log_queue.empty():
        try:
            batch.append(_log_queue.get_nowait())
        except asyncio.QueueEmpty:
            break
    if batch:
        _flush_batch(batch)


def _flush_batch(items: list[dict]):
    from models import LLMCallLog

    db = SessionLocal()
    try:
        for item in items:
            db.add(LLMCallLog(**item))
        db.commit()
    except Exception:
        _logger.exception("flush %d llm log entries failed", len(items))
        db.rollback()
    finally:
        db.close()


def enqueue_log(
    *,
    purpose,
    user_id=None,
    record_id=None,
    case_id=None,
    model="",
    temperature=None,
    max_tokens=None,
    latency_ms=0,
    status="success",
    error_type=None,
    error_message=None,
    request_text="",
    response_text="",
    usage=None,
    meta=None,
    api_key_id=None,
    config_id=None,
    provider_name="deepseek",
    key_price_input=None,
    key_price_output=None,
):
    if _log_queue is None:
        return
    entry = _build_entry(
        purpose=purpose,
        user_id=user_id,
        record_id=record_id,
        case_id=case_id,
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        latency_ms=latency_ms,
        status=status,
        error_type=error_type,
        error_message=error_message,
        request_text=request_text,
        response_text=response_text,
        usage=usage,
        meta=meta,
        api_key_id=api_key_id,
        config_id=config_id,
        provider_name=provider_name,
        key_price_input=key_price_input,
        key_price_output=key_price_output,
    )
    try:
        _log_queue.put_nowait(entry)
    except asyncio.QueueFull:
        _logger.warning("llm log queue full, dropping entry for %s", entry.get("purpose"))
