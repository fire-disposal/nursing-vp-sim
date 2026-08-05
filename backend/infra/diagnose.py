"""Runtime diagnostics: bounded error capture, persistence, and snapshots."""

from __future__ import annotations

import hashlib
import logging
import os
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from core.config import APP_VERSION
from infra.error_archive import ErrorArchive

log = logging.getLogger(__name__)

_MAX_ERRORS = 2000
_CACHE_TTL = 120
_RECENT_ERRORS_N = 20
_DEDUP_WINDOW = 300
_DEDUP_HASH_HEAD = 300
_MSG_MAX = 4000
_MSG_HEAD = 1200
_ARCHIVE_PATH = os.getenv("DIAGNOSTIC_ERROR_ARCHIVE", "/app/data/diagnostics/backend-errors.jsonl")
_ARCHIVE_MAX_BYTES = int(os.getenv("DIAGNOSTIC_ERROR_ARCHIVE_MAX_MB", "5")) * 1024 * 1024
_ARCHIVE_BACKUPS = int(os.getenv("DIAGNOSTIC_ERROR_ARCHIVE_BACKUPS", "3"))
_ARCHIVE_FLUSH_SECONDS = 30
_PROCESS_START = time.time()


def _truncate_message(msg: str) -> str:
    if len(msg) <= _MSG_MAX:
        return msg
    marker = "\n...[truncated]...\n"
    tail = _MSG_MAX - _MSG_HEAD - len(marker)
    return f"{msg[:_MSG_HEAD]}{marker}{msg[-tail:]}"


def _fingerprint(logger: str, message: str) -> str:
    normalized = " ".join(message[:_DEDUP_HASH_HEAD].split())
    return hashlib.sha256(f"{logger}\0{normalized}".encode()).hexdigest()[:16]


@dataclass
class ErrorEntry:
    level: str
    logger: str
    message: str
    fingerprint: str
    first_seen: float
    last_seen: float
    count: int = 1
    persisted_count: int = 0
    last_persisted: float = 0

    def as_dict(self, *, count: int | None = None, source: str = "memory") -> dict:
        return {
            "fingerprint": self.fingerprint,
            "level": self.level,
            "logger": self.logger,
            "message": self.message,
            "count": self.count if count is None else count,
            "first_seen": datetime.fromtimestamp(self.first_seen, tz=UTC).isoformat(),
            "last_seen": datetime.fromtimestamp(self.last_seen, tz=UTC).isoformat(),
            "source": source,
        }


class ErrorCaptureHandler(logging.Handler):
    """Capture ERROR+ records, deduplicate bursts, and persist bounded aggregates."""

    def __init__(self, max_errors: int = _MAX_ERRORS, archive: ErrorArchive | None = None):
        super().__init__(level=logging.ERROR)
        self.buffer: deque[ErrorEntry] = deque(maxlen=max_errors)
        self._entries: dict[tuple[str, str], ErrorEntry] = {}
        self.archive = archive
        self.setFormatter(logging.Formatter("%(message)s"))

    def emit(self, record: logging.LogRecord) -> None:
        try:
            message = _truncate_message(self.format(record))
            now = record.created or time.time()
            key = (record.name, message[:_DEDUP_HASH_HEAD])
            entry = self._entries.get(key)

            if entry is not None and now - entry.last_seen <= _DEDUP_WINDOW:
                entry.count += 1
                entry.last_seen = now
                if now - entry.last_persisted >= _ARCHIVE_FLUSH_SECONDS:
                    self._persist_delta(entry)
                return

            entry = ErrorEntry(
                level=record.levelname,
                logger=record.name,
                message=message,
                fingerprint=_fingerprint(record.name, message),
                first_seen=now,
                last_seen=now,
            )
            self.buffer.append(entry)
            self._entries[key] = entry
            self._prune_entries()
            self._persist_delta(entry)
        except Exception:
            self.handleError(record)

    def _persist_delta(self, entry: ErrorEntry) -> None:
        delta = entry.count - entry.persisted_count
        if delta <= 0 or self.archive is None:
            return
        event = entry.as_dict(count=delta, source="archive")
        event["time"] = event["last_seen"]
        event["version"] = APP_VERSION
        self.archive.append(event)
        entry.persisted_count = entry.count
        entry.last_persisted = entry.last_seen

    def _prune_entries(self) -> None:
        live_ids = {id(entry) for entry in self.buffer}
        stale = [key for key, entry in self._entries.items() if id(entry) not in live_ids]
        for key in stale:
            del self._entries[key]

    def get_recent(self, n: int = _RECENT_ERRORS_N) -> list[dict]:
        return [entry.as_dict() for entry in list(self.buffer)[-n:]]

    def unpersisted_events(self, since: datetime) -> list[dict]:
        cutoff = since.timestamp()
        events = []
        for entry in self.buffer:
            delta = entry.count - entry.persisted_count
            if delta > 0 and entry.last_seen >= cutoff:
                event = entry.as_dict(count=delta)
                event["time"] = event["last_seen"]
                events.append(event)
        return events

    def count_since(self, seconds: int) -> int:
        cutoff = time.time() - seconds
        return sum(entry.count for entry in self.buffer if entry.last_seen >= cutoff)

    @property
    def unique_error_count_24h(self) -> int:
        cutoff = time.time() - 86400
        return len({entry.fingerprint for entry in self.buffer if entry.last_seen >= cutoff})


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
    active_sessions: int = 0
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
        try:
            self._archive = ErrorArchive(
                _ARCHIVE_PATH,
                max_bytes=_ARCHIVE_MAX_BYTES,
                backup_count=_ARCHIVE_BACKUPS,
            )
        except OSError:
            log.exception("Diagnostic error archive unavailable; continuing with memory buffer")
        self._handler = ErrorCaptureHandler(archive=self._archive)
        logging.root.addHandler(self._handler)
        log.info("ErrorCaptureHandler installed (archive=%s)", bool(self._archive))

    def set_app(self, app) -> None:
        self._app_ref = app

    @property
    def _active_sessions(self) -> int:
        try:
            metrics = getattr(self._app_ref.state, "metrics", None) if self._app_ref else None
            return metrics.snapshot().get("active_sessions", 0) if metrics else 0
        except Exception:
            log.warning("Metrics active-session snapshot failed", exc_info=True)
            return 0

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
            return {
                "degraded_providers": router.degraded_count() if hasattr(router, "degraded_count") else 0,
                "global_degraded": getattr(router, "global_degraded", False),
                "degraded_by_reason": router.degraded_by_reason() if hasattr(router, "degraded_by_reason") else {},
            }
        except Exception as exc:
            return {"status": "error", "detail": str(exc)[:200]}

    def get_error_context(self, *, minutes: int = 60, max_groups: int = 20) -> dict:
        minutes = max(1, min(minutes, 1440))
        max_groups = max(1, min(max_groups, 50))
        since = datetime.now(UTC) - timedelta(minutes=minutes)
        events = self._archive.query(since=since, limit=1000) if self._archive else []
        if self._handler:
            events.extend(self._handler.unpersisted_events(since))

        groups: dict[str, dict] = {}
        for event in events:
            fp = str(event.get("fingerprint") or _fingerprint(str(event.get("logger", "")), str(event.get("message", ""))))
            count = max(1, int(event.get("count", 1) or 1))
            first_seen = str(event.get("first_seen") or event.get("time") or "")
            last_seen = str(event.get("last_seen") or event.get("time") or "")
            group = groups.setdefault(
                fp,
                {
                    "fingerprint": fp,
                    "level": event.get("level", "ERROR"),
                    "logger": event.get("logger", ""),
                    "message": str(event.get("message", ""))[:_MSG_MAX],
                    "count": 0,
                    "first_seen": first_seen,
                    "last_seen": last_seen,
                },
            )
            group["count"] += count
            if first_seen and (not group["first_seen"] or first_seen < group["first_seen"]):
                group["first_seen"] = first_seen
            if last_seen and last_seen > group["last_seen"]:
                group["last_seen"] = last_seen
                group["message"] = str(event.get("message", ""))[:_MSG_MAX]

        ordered = sorted(groups.values(), key=lambda item: (item["last_seen"], item["count"]), reverse=True)
        selected = ordered[:max_groups]
        return {
            "window_minutes": minutes,
            "total_events": sum(group["count"] for group in groups.values()),
            "unique_groups": len(groups),
            "truncated": len(ordered) > len(selected),
            "groups": selected,
        }

    async def build_snapshot(self) -> dict:
        now_iso = datetime.now(UTC).isoformat()
        if self._handler:
            errors = {
                "last_5min": self._handler.count_since(300),
                "last_hour": self._handler.count_since(3600),
                "total_captured": len(self._handler.buffer),
                "unique_24h": self._handler.unique_error_count_24h,
                "burst_5min": self._handler.count_since(300),
                "recent": self._handler.get_recent(),
            }
        else:
            errors = {"last_5min": 0, "last_hour": 0, "total_captured": 0, "unique_24h": 0, "burst_5min": 0, "recent": []}

        fe_buffer = getattr(self._app_ref.state, "frontend_error_buffer", None) if self._app_ref else None
        frontend_errors = fe_buffer.snapshot() if fe_buffer else {"last_5min": 0, "last_hour": 0, "total_captured": 0, "recent": []}
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

    async def get_diagnose(self) -> dict:
        now = time.time()
        if self._cache and now - self._cache_time < _CACHE_TTL:
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
