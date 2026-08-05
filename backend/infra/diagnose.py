"""Application diagnostics: bounded error capture, persistence and snapshots."""

from __future__ import annotations

import hashlib
import logging
import os
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from core.config import APP_VERSION
from infra.error_archive import ErrorArchive

log = logging.getLogger(__name__)

_MAX_ERRORS = 2000
_CACHE_TTL = 120
_RECENT_ERRORS_N = 20
_DEDUP_WINDOW = 300
_DEDUP_HASH_HEAD = 200
_MSG_MAX = 4000
_MSG_HEAD = 1200
_PROCESS_START = time.time()


def _truncate_message(msg: str) -> str:
    if len(msg) <= _MSG_MAX:
        return msg
    marker = "\n...[truncated]...\n"
    tail = _MSG_MAX - _MSG_HEAD - len(marker)
    return f"{msg[:_MSG_HEAD]}{marker}{msg[-tail:]}"


def _fingerprint(logger_name: str, message: str) -> str:
    normalized = f"{logger_name}\n{message[:_DEDUP_HASH_HEAD]}".encode("utf-8", errors="replace")
    return hashlib.sha256(normalized).hexdigest()[:16]


@dataclass
class ErrorEntry:
    level: str
    logger: str
    message: str
    time: str
    timestamp: float
    fingerprint: str
    count: int = 1
    first_seen: str = ""


class ErrorCaptureHandler(logging.Handler):
    """Capture ERROR+ logs in memory and optionally in a bounded JSONL archive."""

    def __init__(self, max_errors: int = _MAX_ERRORS, archive: ErrorArchive | None = None):
        super().__init__(level=logging.ERROR)
        self.buffer: deque[ErrorEntry] = deque(maxlen=max_errors)
        self.archive = archive
        self._dedup: dict[tuple[str, str], tuple[float, ErrorEntry]] = {}
        self.setFormatter(logging.Formatter("%(asctime)s.%(msecs)03d %(levelname)-8s %(name)s %(message)s"))

    def _dedup_key(self, logger_name: str, message: str) -> tuple[str, str]:
        return logger_name, message[:_DEDUP_HASH_HEAD]

    def _prune_dedup(self, now: float) -> None:
        stale = [key for key, (seen_at, _) in self._dedup.items() if now - seen_at > _DEDUP_WINDOW]
        for key in stale:
            del self._dedup[key]

    def emit(self, record: logging.LogRecord) -> None:
        try:
            message = _truncate_message(self.format(record))
            timestamp = float(record.created)
            now_iso = datetime.fromtimestamp(timestamp, tz=UTC).isoformat()
            key = self._dedup_key(record.name, message)
            self._prune_dedup(timestamp)

            existing = self._dedup.get(key)
            if existing is not None:
                _, entry = existing
                entry.count += 1
                entry.timestamp = timestamp
                entry.time = now_iso
                self._dedup[key] = (timestamp, entry)
                return

            entry = ErrorEntry(
                level=record.levelname,
                logger=record.name,
                message=message,
                time=now_iso,
                timestamp=timestamp,
                fingerprint=_fingerprint(record.name, message),
                first_seen=now_iso,
            )
            self.buffer.append(entry)
            self._dedup[key] = (timestamp, entry)
            if self.archive is not None:
                self.archive.append(_serialize_entry(entry, version=APP_VERSION))
        except Exception:
            self.handleError(record)

    def get_recent(self, n: int = _RECENT_ERRORS_N) -> list[dict[str, Any]]:
        return [_serialize_entry(entry) for entry in list(self.buffer)[-n:]]

    def _count_since(self, seconds: int) -> int:
        cutoff = time.time() - seconds
        return sum(entry.count for entry in self.buffer if entry.timestamp >= cutoff)

    @property
    def error_count_last_hour(self) -> int:
        return self._count_since(3600)

    @property
    def error_count_last_5min(self) -> int:
        return self._count_since(300)

    @property
    def unique_error_count_24h(self) -> int:
        cutoff = time.time() - 86400
        return len({entry.fingerprint for entry in self.buffer if entry.timestamp >= cutoff})

    @property
    def error_burst_5min(self) -> int:
        return self.error_count_last_5min


def _serialize_entry(entry: ErrorEntry, *, version: str | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {
        "time": entry.time,
        "first_seen": entry.first_seen,
        "level": entry.level,
        "logger": entry.logger,
        "message": entry.message,
        "fingerprint": entry.fingerprint,
        "count": entry.count,
    }
    if version is not None:
        result["version"] = version
    return result


@dataclass
class DiagnoseSnapshot:
    server: dict[str, Any] = field(
        default_factory=lambda: {
            "version": APP_VERSION,
            "uptime_seconds": int(time.time() - _PROCESS_START),
        }
    )
    database: dict[str, Any] | None = None
    llm: dict[str, Any] | None = None
    errors: dict[str, Any] | None = None
    active_sessions: int = 0
    cached_at: str = ""


class DiagnoseService:
    def __init__(self) -> None:
        self._handler: ErrorCaptureHandler | None = None
        self._archive: ErrorArchive | None = None
        self._cache: dict[str, Any] | None = None
        self._cache_time = 0.0
        self._app_ref = None

    def install_handler(self) -> None:
        if self._handler is not None:
            return
        archive_path = os.getenv("DIAGNOSTIC_ERROR_PATH", "/app/data/diagnostics/backend-errors.jsonl").strip()
        if archive_path:
            try:
                max_mb = max(1, int(os.getenv("DIAGNOSTIC_ERROR_MAX_MB", "10")))
                backup_count = max(1, int(os.getenv("DIAGNOSTIC_ERROR_BACKUPS", "3")))
                self._archive = ErrorArchive(archive_path, max_bytes=max_mb * 1024 * 1024, backup_count=backup_count)
            except Exception:
                log.exception("Diagnostic error archive unavailable; continuing with memory buffer")
        self._handler = ErrorCaptureHandler(archive=self._archive)
        logging.root.addHandler(self._handler)
        log.info("Diagnostic error capture installed (persistent=%s)", self._archive is not None)

    def set_app(self, app) -> None:
        self._app_ref = app

    @property
    def archive(self) -> ErrorArchive | None:
        return self._archive

    @property
    def _active_sessions(self) -> int:
        if self._app_ref is None:
            return 0
        try:
            metrics = getattr(self._app_ref.state, "metrics", None)
            return metrics.snapshot().get("active_sessions", 0) if metrics else 0
        except Exception:
            log.warning("Metrics active session snapshot failed", exc_info=True)
            return 0

    async def _db_status(self) -> dict[str, Any]:
        import asyncio

        def _check() -> dict[str, Any]:
            try:
                from sqlalchemy import text
                from core.database import engine

                pool = getattr(engine, "pool", None)
                info: dict[str, Any] = {"connected": False, "pool_size": 0, "checked_out": 0}
                if pool:
                    size = getattr(pool, "size", 0)
                    checked_out = getattr(pool, "checkedout", 0)
                    info["pool_size"] = size() if callable(size) else size
                    info["checked_out"] = checked_out() if callable(checked_out) else checked_out
                with engine.connect() as conn:
                    conn.execute(text("SELECT 1"))
                info["connected"] = True
                return info
            except Exception as exc:
                return {"connected": False, "error": str(exc)[:200]}

        return await asyncio.to_thread(_check)

    @property
    def _llm_status(self) -> dict[str, Any]:
        if self._app_ref is None:
            return {"status": "unknown"}
        try:
            router = getattr(self._app_ref.state, "llm_router", None)
            if router is None:
                return {"status": "not_loaded"}
            return {
                "degraded_providers": router.degraded_count() if hasattr(router, "degraded_count") else 0,
                "global_degraded": getattr(router, "global_degraded", False),
                "degraded_by_reason": router.degraded_by_reason() if hasattr(router, "degraded_by_reason") else {},
            }
        except Exception as exc:
            return {"status": "error", "detail": str(exc)[:200]}

    async def build_snapshot(self) -> dict[str, Any]:
        now_iso = datetime.now(UTC).isoformat()
        if self._handler:
            errors = {
                "last_5min": self._handler.error_count_last_5min,
                "last_hour": self._handler.error_count_last_hour,
                "total_captured": sum(entry.count for entry in self._handler.buffer),
                "unique_24h": self._handler.unique_error_count_24h,
                "burst_5min": self._handler.error_burst_5min,
                "recent": self._handler.get_recent(),
                "persistent": self._archive is not None,
            }
        else:
            errors = {
                "last_5min": 0,
                "last_hour": 0,
                "total_captured": 0,
                "unique_24h": 0,
                "burst_5min": 0,
                "recent": [],
                "persistent": False,
            }

        frontend_buffer = getattr(self._app_ref.state, "frontend_error_buffer", None) if self._app_ref else None
        frontend_errors = frontend_buffer.snapshot() if frontend_buffer else {
            "last_5min": 0,
            "last_hour": 0,
            "total_captured": 0,
            "recent": [],
        }
        snapshot = DiagnoseSnapshot(
            database=await self._db_status(),
            llm=self._llm_status,
            errors=errors,
            active_sessions=self._active_sessions,
            cached_at=now_iso,
        )
        return {
            "server": snapshot.server,
            "database": snapshot.database,
            "llm": snapshot.llm,
            "errors": snapshot.errors,
            "frontend_errors": frontend_errors,
            "active_sessions": snapshot.active_sessions,
            "cached_at": snapshot.cached_at,
        }

    async def get_diagnose(self, *, fresh: bool = False) -> dict[str, Any]:
        now = time.time()
        if not fresh and self._cache and now - self._cache_time < _CACHE_TTL:
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
