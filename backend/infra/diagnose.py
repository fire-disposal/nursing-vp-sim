"""Runtime diagnostics: bounded error capture, persistence, and snapshots."""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from core.config import APP_VERSION
from infra.error_archive import ErrorArchive
from infra.error_buffer import (
    BufferConfig,
    DedupArchiveBuffer,
    DedupEntry,
    ErrorGroup,
    aggregate,
    fingerprint,
)

log = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 120
_RECENT_ERRORS_N = 20
_MSG_MAX = 4000
_MSG_HEAD = 1200
_MAX_GROUP_MESSAGES = 5
_ARCHIVE_WINDOW_LIMIT = 20000
_PROCESS_START = time.time()

_CONFIG = BufferConfig(
    archive_path=os.getenv("DIAGNOSTIC_ERROR_ARCHIVE", "/app/data/diagnostics/backend-errors.jsonl"),
    archive_max_bytes=int(os.getenv("DIAGNOSTIC_ERROR_ARCHIVE_MAX_MB", "5")) * 1024 * 1024,
    archive_backups=int(os.getenv("DIAGNOSTIC_ERROR_ARCHIVE_BACKUPS", "3")),
    max_entries=2000,
    dedup_window=300,
    hash_head=300,
    query_limit=_ARCHIVE_WINDOW_LIMIT,
)


def _truncate_message(msg: str) -> str:
    if len(msg) <= _MSG_MAX:
        return msg
    marker = "\n...[truncated]...\n"
    tail = _MSG_MAX - _MSG_HEAD - len(marker)
    return f"{msg[:_MSG_HEAD]}{marker}{msg[-tail:]}"


def _event(entry: DedupEntry, count: int, source: str) -> dict:
    first_seen = datetime.fromtimestamp(entry.first_seen, tz=UTC).isoformat()
    last_seen = datetime.fromtimestamp(entry.last_seen, tz=UTC).isoformat()
    return {
        "fingerprint": entry.fingerprint,
        "level": entry.payload["level"],
        "logger": entry.payload["logger"],
        "message": entry.payload["message"],
        "count": count,
        "first_seen": first_seen,
        "last_seen": last_seen,
        "source": source,
        # 档案按 ``time`` 过滤窗口（见 ErrorArchive.query）。
        "time": last_seen,
        "version": APP_VERSION,
    }


def _fallback_fingerprint(event: dict) -> str:
    return fingerprint(str(event.get("logger", "")), message=str(event.get("message", "")), head=_CONFIG.hash_head)


class ErrorCaptureHandler(logging.Handler):
    """Capture ERROR+ records, deduplicate bursts, and persist bounded aggregates."""

    def __init__(self, archive: ErrorArchive | None = None):
        super().__init__(level=logging.ERROR)
        self._buffer = DedupArchiveBuffer(_CONFIG, archive=archive, build_event=_event)
        self.setFormatter(logging.Formatter("%(message)s"))

    @property
    def archive(self) -> ErrorArchive | None:
        return self._buffer.archive

    def emit(self, record: logging.LogRecord) -> None:
        try:
            message = _truncate_message(self.format(record))
            now = record.created or time.time()
            self._buffer.record(
                key=(record.name, message[: _CONFIG.hash_head]),
                fingerprint=fingerprint(record.name, message=message, head=_CONFIG.hash_head),
                payload={"level": record.levelname, "logger": record.name, "message": message},
                now=now,
            )
        except Exception:
            self.handleError(record)

    def get_recent(self, n: int = _RECENT_ERRORS_N) -> list[dict]:
        return [_event(entry, entry.count, "memory") for entry in list(self._buffer.buffer)[-n:]]

    def unpersisted_events(self, since: datetime) -> list[dict]:
        return self._buffer.unpersisted(since)


def _backend_group(group: ErrorGroup) -> dict:
    """分组投影：``level``/``logger`` 取首见事件，``message`` 取最近事件并保留变体。"""
    messages: list[str] = []
    for event in group.events:
        msg = str(event.get("message", ""))[:_MSG_MAX]
        if msg not in messages and len(messages) < _MAX_GROUP_MESSAGES:
            messages.append(msg)
    return {
        "fingerprint": group.fingerprint,
        "level": group.first_event.get("level", "ERROR"),
        "logger": group.first_event.get("logger", ""),
        "message": str(group.latest_event.get("message", ""))[:_MSG_MAX],
        "messages": messages,
        "count": group.count,
        "first_seen": group.first_seen,
        "last_seen": group.last_seen,
    }


@dataclass
class DiagnoseSnapshot:
    server: dict = field(
        default_factory=lambda: {
            "version": APP_VERSION,
            "uptime_seconds": int(time.time() - _PROCESS_START),
        }
    )
    database: dict | None = None
    llm: dict | None = None
    errors: dict | None = None
    cached_at: str = ""


class DiagnoseService:
    def __init__(self):
        self._handler: ErrorCaptureHandler | None = None
        self._archive: ErrorArchive | None = None
        self._cache: dict | None = None
        self._cache_time: float = 0
        self._app_ref = None

    def install_handler(self) -> None:
        if self._handler is not None:
            return
        self._archive = _CONFIG.open_archive()
        self._handler = ErrorCaptureHandler(archive=self._archive)
        logging.root.addHandler(self._handler)
        log.info("ErrorCaptureHandler installed (archive=%s)", bool(self._archive))

    def set_app(self, app) -> None:
        self._app_ref = app

    def _events_since(self, now: datetime, seconds: int) -> list[dict]:
        """共享档案 + 本进程未落盘增量的事件并集（跨 worker 口径的唯一来源）。"""
        since = now - timedelta(seconds=seconds)
        events = self._archive.query(since=since, limit=_ARCHIVE_WINDOW_LIMIT) if self._archive else []
        if self._handler:
            events.extend(self._handler.unpersisted_events(since))
        return events

    def error_windows(self, now: datetime | None = None) -> dict:
        """跨 worker 窗口计数（scope=workers）：全部按**事件发生时间**求「窗口内发生次数」。

        与错误分组同源（档案 + 未落盘增量），故 ``last_5min``/``last_hour`` 与
        ``get_error_context()`` 的 ``total_events`` 可互相印证；``unique_24h`` 为 24h 内
        不同指纹数。窗口边界归属精度受档案落盘节奏限制（同组最多每 30s 补记一次增量）。
        """
        now = now or datetime.now(UTC)
        events = self._events_since(now, 86400)
        return aggregate(events, now, windows=_CONFIG.windows, fallback_fingerprint=_fallback_fingerprint).counts

    async def _db_status(self) -> dict:
        import asyncio

        def _check():
            try:
                from sqlalchemy import text

                from core.database import engine

                pool = getattr(engine, "pool", None)
                info = {"connected": False, "pool_size": 0, "checked_out": 0}
                if pool:
                    size = getattr(pool, "size", 0)
                    checked = getattr(pool, "checkedout", 0)
                    info["pool_size"] = size() if callable(size) else size
                    info["checked_out"] = checked() if callable(checked) else checked
                with engine.connect() as conn:
                    conn.execute(text("SELECT 1"))
                info["connected"] = True
                return info
            except Exception as exc:
                return {"connected": False, "error": str(exc)[:200]}

        return await asyncio.to_thread(_check)

    @property
    def _llm_status(self) -> dict:
        try:
            router = getattr(self._app_ref.state, "llm_router", None) if self._app_ref else None
            if router is None:
                return {"status": "not_loaded"}
            status = {
                "degraded_providers": router.degraded_count() if hasattr(router, "degraded_count") else 0,
                "global_degraded": getattr(router, "global_degraded", False),
                "degraded_by_reason": router.degraded_by_reason() if hasattr(router, "degraded_by_reason") else {},
            }
            # env 兜底与落库失败此前"只记不读"：没有任何出口能看出"钱花在 env key 上"
            # 或"成本账没写进 DB"。这里一并透出（均为 worker-local 进程内计数）。
            if hasattr(router, "env_fallback_usage"):
                status["env_fallback"] = router.env_fallback_usage()
            if hasattr(router, "persist_failures"):
                status["persist_failures"] = router.persist_failures
            log_worker = getattr(self._app_ref.state, "log_worker", None) if self._app_ref else None
            if log_worker is not None and hasattr(log_worker, "queue_stats"):
                status["log_queue"] = log_worker.queue_stats()
            return status
        except Exception as exc:
            return {"status": "error", "detail": str(exc)[:200]}

    def get_error_context(self, *, minutes: int = 60, max_groups: int = 20) -> dict:
        minutes = max(1, min(minutes, 1440))
        max_groups = max(1, min(max_groups, 50))
        now = datetime.now(UTC)
        groups = aggregate(
            self._events_since(now, minutes * 60),
            now,
            windows=_CONFIG.windows,
            fallback_fingerprint=_fallback_fingerprint,
        ).groups

        ordered = sorted(groups.values(), key=lambda group: (group.last_seen, group.count), reverse=True)
        selected = ordered[:max_groups]
        return {
            "window_minutes": minutes,
            "total_events": sum(group.count for group in groups.values()),
            "unique_groups": len(groups),
            "truncated": len(ordered) > len(selected),
            "groups": [_backend_group(group) for group in selected],
        }

    async def build_snapshot(self) -> dict:
        now_iso = datetime.now(UTC).isoformat()
        errors = {
            **self.error_windows(),
            "recent": self._handler.get_recent() if self._handler else [],
        }

        fe_buffer = getattr(self._app_ref.state, "frontend_error_buffer", None) if self._app_ref else None
        frontend_errors = (
            fe_buffer.aggregate_snapshot()
            if fe_buffer
            else {"last_5min": 0, "last_hour": 0, "unique_24h": 0, "total_captured": 0, "groups": []}
        )
        snapshot = DiagnoseSnapshot(
            database=await self._db_status(),
            llm=self._llm_status,
            errors=errors,
            cached_at=now_iso,
        )
        return {
            "server": snapshot.server,
            "database": snapshot.database,
            "llm": snapshot.llm,
            "errors": snapshot.errors,
            "frontend_errors": frontend_errors,
            "cached_at": snapshot.cached_at,
        }

    async def get_diagnose(self) -> dict:
        now = time.time()
        if self._cache and now - self._cache_time < CACHE_TTL_SECONDS:
            return self._cache
        self._cache = await self.build_snapshot()
        self._cache_time = now
        return self._cache


_service: DiagnoseService | None = None


def get_diagnose_service() -> DiagnoseService:
    global _service
    if _service is None:
        _service = DiagnoseService()
    return _service
