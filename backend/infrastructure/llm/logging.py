"""LLM 调用日志服务 —— 异步队列批量写入，独立 DB session"""

import asyncio
import contextlib
import json as _json
import logging
import os
import time

from core.config import (
    LLM_COST_CURRENCY,
    LLM_PRICE_INPUT_PER_1M,
    LLM_PRICE_OUTPUT_PER_1M,
)
from core.database import SessionLocal
from models import LLMCallLog

log = logging.getLogger(__name__)


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


class LogWorker:
    def __init__(self, overflow_dir: str = "", overflow_max_size_mb: int = 10, overflow_max_files: int = 5):
        self._queue: asyncio.Queue[dict] | None = None
        self._task: asyncio.Task | None = None
        self._overflow_dir = overflow_dir
        self._overflow_max_bytes = overflow_max_size_mb * 1024 * 1024
        self._overflow_max_files = max(overflow_max_files, 1)
        if overflow_dir:
            os.makedirs(overflow_dir, exist_ok=True)

    async def start(self):
        self._queue = asyncio.Queue(maxsize=2000)
        self._task = asyncio.create_task(self._loop())

    async def stop(self):
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        self._queue = None

    async def _loop(self):
        batch: list[dict] = []
        _drain_count = 0
        while True:
            try:
                if self._queue is None:
                    break
                item = await asyncio.wait_for(self._queue.get(), timeout=2.0)
                batch.append(item)
            except TimeoutError:
                _drain_count += 1
                if _drain_count >= 5 and self._overflow_dir:
                    self._drain_overflow_files(batch)
                    _drain_count = 0
                if batch:
                    self._flush(batch)
                    batch.clear()
                continue
            except asyncio.CancelledError:
                break

            if len(batch) >= 20:
                self._flush(batch)
                batch.clear()

        if self._queue is not None:
            while not self._queue.empty():
                try:
                    batch.append(self._queue.get_nowait())
                except asyncio.QueueEmpty:
                    break
        if self._overflow_dir:
            self._drain_overflow_files(batch)
        if batch:
            self._flush(batch)

    @staticmethod
    def _flush(items: list[dict]):
        db = SessionLocal()
        try:
            failed = 0
            for item in items:
                try:
                    db.add(LLMCallLog(**item))
                    db.flush()
                except Exception:
                    failed += 1
                    db.rollback()
                    log.warning(
                        "flush single llm log entry failed: %s",
                        _json.dumps(item, ensure_ascii=False, default=str)[:500],
                    )
            if failed == 0:
                db.commit()
            elif failed < len(items):
                db.commit()
                log.warning("flush %d/%d llm log entries failed", failed, len(items))
            else:
                db.rollback()
                log.warning("flush all %d llm log entries failed", len(items))
        except Exception:
            log.exception("flush %d llm log entries batch failed", len(items))
            db.rollback()
        finally:
            db.close()

    def enqueue(
        self,
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
        if self._queue is None:
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
            self._queue.put_nowait(entry)
        except asyncio.QueueFull:
            if self._overflow_dir:
                self._write_overflow(entry)
            else:
                log.error("llm log queue full (%d), entry lost", self._queue.maxsize)

    def _overflow_path(self) -> str:
        ts = time.strftime("%Y%m%d_%H%M%S")
        return os.path.join(self._overflow_dir, f"llm_log_overflow_{ts}.jsonl")

    def _write_overflow(self, entry: dict) -> None:
        try:
            path = self._overflow_path()
            with open(path, "a", encoding="utf-8") as f:
                f.write(_json.dumps(entry, ensure_ascii=False, default=str) + "\n")
        except OSError:
            log.exception("llm log overflow write failed, entry lost")

    def _drain_overflow_files(self, batch: list[dict]) -> None:
        if not self._overflow_dir:
            return
        try:
            files = sorted(
                [f for f in os.listdir(self._overflow_dir) if f.endswith(".jsonl")],
                key=lambda f: os.path.getmtime(os.path.join(self._overflow_dir, f)),
            )
        except OSError:
            return

        for fname in files:
            fpath = os.path.join(self._overflow_dir, fname)
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            entry = _json.loads(line)
                        except _json.JSONDecodeError:
                            log.warning("corrupted overflow line in %s, skipping", fname)
                            continue
                        batch.append(entry)
                        if len(batch) >= 20:
                            self._flush(batch)
                            batch.clear()
                os.remove(fpath)
                log.info("drained overflow file: %s", fname)
            except OSError:
                break

        self._rotate_overflow_files()

    def _rotate_overflow_files(self) -> None:
        if not self._overflow_dir:
            return
        try:
            files = sorted(
                [f for f in os.listdir(self._overflow_dir) if f.endswith(".jsonl")],
                key=lambda f: os.path.getmtime(os.path.join(self._overflow_dir, f)),
            )
        except OSError:
            return

        current = files[-1] if files else ""
        current_path = os.path.join(self._overflow_dir, current) if current else ""
        if current_path and os.path.getsize(current_path) >= self._overflow_max_bytes:
            new_name = current.replace(".jsonl", "") + f"_r{int(time.time())}.jsonl"
            try:
                os.rename(current_path, os.path.join(self._overflow_dir, new_name))
            except OSError:
                pass

        all_files = sorted(
            [f for f in os.listdir(self._overflow_dir) if f.endswith(".jsonl")],
            key=lambda f: os.path.getmtime(os.path.join(self._overflow_dir, f)),
        )
        while len(all_files) > self._overflow_max_files:
            oldest = os.path.join(self._overflow_dir, all_files[0])
            try:
                os.remove(oldest)
                log.info("rotated out old overflow file: %s", all_files[0])
            except OSError:
                break
            all_files.pop(0)
