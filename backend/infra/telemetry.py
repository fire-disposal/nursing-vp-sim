"""Frontend telemetry buffer, shared archive, and ingest endpoint.

Telemetry is best-effort runtime infrastructure: it never blocks user requests and is exposed
through diagnostics snapshots.

进程模型：uvicorn 以 ``--workers 2`` 运行，每个 worker 有独立的进程内缓冲。只读进程内缓冲
会让 /api/diagnose 只看到一半遥测（2026-09-24 机房崩溃取证时，同一端点两次调用返回两套
互斥计数）。因此每个 worker 在去重后把错误增量落到共享 JSONL 归档
（``/app/data/diagnostics/frontend-errors.jsonl``，见 deploy/docker-compose.prod.yml 的卷），
快照时把「共享归档 + 本进程未落盘增量」合并，得到跨 worker 口径。
"""

from __future__ import annotations

import hashlib
import logging
import os
import time
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from core.rate_limits import get_client_ip
from infra.error_archive import ErrorArchive

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/telemetry", tags=["遥测"])

_MAX_ERRORS = 2000
_DEDUP_WINDOW = 300
_DEDUP_HASH_HEAD = 120
_MSG_MAX = 1000
_MAX_BATCH = 20
_RATE_WINDOW = 60
_RATE_MAX = 5
_ARCHIVE_PATH = os.getenv("FRONTEND_ERROR_ARCHIVE", "/app/data/diagnostics/frontend-errors.jsonl")
_ARCHIVE_MAX_BYTES = int(os.getenv("FRONTEND_ERROR_ARCHIVE_MAX_MB", "2")) * 1024 * 1024
_ARCHIVE_BACKUPS = int(os.getenv("FRONTEND_ERROR_ARCHIVE_BACKUPS", "2"))
_ARCHIVE_FLUSH_SECONDS = 30
_ARCHIVE_QUERY_LIMIT = 1000
# 前端遥测快照窗口（分钟）——诊断端点的 frontend_errors.window 标签由此派生。
SNAPSHOT_WINDOW_MINUTES = 60
_GROUPS_N = 20
_BURST_SECONDS = 300
_HOUR_SECONDS = 3600
_DAY_SECONDS = 86400

_rate_state: dict[str, tuple[float, int]] = {}


def _fingerprint(source: str, error_type: str, message: str) -> str:
    normalized = " ".join(message[:_DEDUP_HASH_HEAD].split())
    return hashlib.sha256(f"{source}\0{error_type}\0{normalized}".encode()).hexdigest()[:16]


def _event_time(event: dict) -> datetime | None:
    try:
        return datetime.fromisoformat(str(event.get("time")))
    except (TypeError, ValueError):
        return None


@dataclass
class FrontendErrorEntry:
    time: str
    error_type: str
    message: str
    url: str = ""
    user_id: int = 0
    ua: str = ""
    source: str = ""
    component_stack: str = ""
    count: int = 1
    timestamp: float = 0.0
    fingerprint: str = ""
    persisted_count: int = 0
    last_persisted: float = 0.0

    def as_event(self, *, count: int) -> dict:
        """归档事件；``time`` 为最近一次发生时间（归档按它过滤窗口）。"""
        return {
            "fingerprint": self.fingerprint,
            "time": datetime.fromtimestamp(self.timestamp, tz=UTC).isoformat(),
            "first_seen": self.time,
            "type": self.error_type,
            "message": self.message,
            "url": self.url,
            "user_id": self.user_id,
            "ua": self.ua,
            "source": self.source,
            "component_stack": self.component_stack,
            "count": count,
        }


_archive: ErrorArchive | None = None
_archive_initialized = False


def get_frontend_error_archive() -> ErrorArchive | None:
    """共享归档单例；不可写时退化为纯进程内缓冲（遥测不能影响业务）。"""
    global _archive, _archive_initialized
    if not _archive_initialized:
        _archive_initialized = True
        try:
            _archive = ErrorArchive(_ARCHIVE_PATH, max_bytes=_ARCHIVE_MAX_BYTES, backup_count=_ARCHIVE_BACKUPS)
        except OSError:
            log.exception("Frontend telemetry archive unavailable; keeping process-local buffer only")
    return _archive


class FrontendErrorBuffer:
    """进程内去重缓冲 + 跨 worker 共享归档；快照不再按 worker 分裂。"""

    def __init__(self, archive: ErrorArchive | None = None):
        self.buffer: deque[FrontendErrorEntry] = deque(maxlen=_MAX_ERRORS)
        self._dedup: dict[tuple[str, str, str], FrontendErrorEntry] = {}
        self.archive = archive if archive is not None else get_frontend_error_archive()

    def _dedup_key(self, source: str, error_type: str, message: str) -> tuple[str, str, str]:
        return (source, error_type, message[:_DEDUP_HASH_HEAD])

    def _prune_dedup(self) -> None:
        live = {id(entry) for entry in self.buffer}
        for key in [k for k, entry in self._dedup.items() if id(entry) not in live]:
            del self._dedup[key]

    def _persist_delta(self, entry: FrontendErrorEntry, *, force: bool = False) -> None:
        delta = entry.count - entry.persisted_count
        if delta <= 0 or self.archive is None:
            return
        if not force and entry.last_persisted and entry.timestamp - entry.last_persisted < _ARCHIVE_FLUSH_SECONDS:
            return
        try:
            self.archive.append(entry.as_event(count=delta))
        except OSError:
            log.warning("Frontend telemetry archive append failed", exc_info=True)
            return
        entry.persisted_count = entry.count
        entry.last_persisted = entry.timestamp

    def ingest(self, *entries: dict) -> None:
        """Ingest one or more error dicts from the telemetry endpoint."""
        now = time.time()
        for e in entries:
            error_type = str(e.get("type", "") or "")[:200]
            message = str(e.get("message", "") or "")[:_MSG_MAX]
            url = str(e.get("url", "") or "")[:500]
            user_id = int(e.get("user_id", 0) or 0)
            ua = str(e.get("ua", "") or "")[:200]
            source = str(e.get("source", "") or "")[:120]
            component_stack = str(e.get("component_stack", "") or "")[:1000]

            key = self._dedup_key(source, error_type, message)
            entry = self._dedup.get(key)
            if entry is not None and now - entry.timestamp <= _DEDUP_WINDOW:
                entry.count += 1
                entry.timestamp = now
                self._persist_delta(entry)
                continue

            entry = FrontendErrorEntry(
                time=datetime.now(UTC).isoformat(),
                error_type=error_type,
                message=message,
                url=url,
                user_id=user_id,
                ua=ua,
                source=source,
                component_stack=component_stack,
                timestamp=now,
                fingerprint=_fingerprint(source, error_type, message),
            )
            self.buffer.append(entry)
            self._dedup[key] = entry
            self._prune_dedup()
            self._persist_delta(entry, force=True)

    def _unpersisted_events(self, since: datetime) -> list[dict]:
        """本进程缓冲里尚未落盘、或落盘后又有增长的增量。"""
        cutoff = since.timestamp()
        events = []
        for entry in self.buffer:
            delta = entry.count - entry.persisted_count
            if delta > 0 and entry.timestamp >= cutoff:
                events.append(entry.as_event(count=delta))
        return events

    def _events(self, since: datetime) -> list[dict]:
        """快照用事件源：归档可用时用「增量 + 归档」，不可用时退化为进程内计数。"""
        if self.archive is None:
            cutoff = since.timestamp()
            return [entry.as_event(count=entry.count) for entry in self.buffer if entry.timestamp >= cutoff]
        return self._unpersisted_events(since)

    def aggregate_snapshot(self, *, window_minutes: int = SNAPSHOT_WINDOW_MINUTES, max_groups: int = _GROUPS_N) -> dict:
        """跨 worker 快照 = 本进程未落盘增量 + 共享归档。

        - ``last_5min`` / ``last_hour``：窗口内发生次数（含其它 worker 已归档的部分）
        - ``total_captured``：24h 内不同错误签名数（原为单进程缓冲长度，会按 worker 分裂）
        - ``groups``：窗口内按 last_seen 倒序的错误签名，带 ``ua``（出事端浏览器）
        """
        now = datetime.now(UTC)
        events = self._events(now - timedelta(seconds=_DAY_SECONDS))
        if self.archive is not None:
            try:
                events.extend(
                    self.archive.query(since=now - timedelta(seconds=_DAY_SECONDS), limit=_ARCHIVE_QUERY_LIMIT)
                )
            except OSError:
                log.warning("Frontend telemetry archive read failed", exc_info=True)

        groups: dict[str, dict] = {}
        burst = 0
        hour = 0
        for event in events:
            last_seen = _event_time(event)
            if last_seen is None:
                continue
            count = max(1, int(event.get("count", 1) or 1))
            age = (now - last_seen).total_seconds()
            if age <= _BURST_SECONDS:
                burst += count
            if age <= _HOUR_SECONDS:
                hour += count

            fingerprint = str(event.get("fingerprint") or "") or _fingerprint(
                str(event.get("source", "")), str(event.get("type", "")), str(event.get("message", ""))
            )
            first_seen = str(event.get("first_seen") or "") or last_seen.isoformat()
            group = groups.get(fingerprint)
            if group is None:
                groups[fingerprint] = {
                    "fingerprint": fingerprint,
                    "type": str(event.get("type", "")),
                    "message": str(event.get("message", "")),
                    "url": str(event.get("url", "")),
                    "user_id": int(event.get("user_id", 0) or 0),
                    "ua": str(event.get("ua", "")),
                    "source": str(event.get("source", "")),
                    "component_stack": str(event.get("component_stack", "")),
                    "count": count,
                    "time": last_seen.isoformat(),
                    "first_seen": first_seen,
                }
                continue

            # 同一签名的最新一次事件决定展示字段（浏览器/页面/用户），计数累加。
            if last_seen.isoformat() >= group["time"]:
                group["time"] = last_seen.isoformat()
                group["message"] = str(event.get("message", "")) or group["message"]
                group["url"] = str(event.get("url", "")) or group["url"]
                group["user_id"] = int(event.get("user_id", 0) or 0) or group["user_id"]
                group["ua"] = str(event.get("ua", "")) or group["ua"]
                group["source"] = str(event.get("source", "")) or group["source"]
                group["component_stack"] = str(event.get("component_stack", "")) or group["component_stack"]
            group["count"] += count
            group["first_seen"] = min(group["first_seen"], first_seen)

        cutoff = (now - timedelta(minutes=window_minutes)).isoformat()
        window = [group for group in groups.values() if group["time"] >= cutoff]
        window.sort(key=lambda group: group["time"], reverse=True)
        # 与后端错误块统一：last_5min/last_hour 为窗口内发生次数，
        # unique_24h 与 total_captured 同义（24h 内不同签名数），后者为历史键名。
        return {
            "last_5min": burst,
            "last_hour": hour,
            "unique_24h": len(groups),
            "total_captured": len(groups),
            "groups": window[:max_groups],
        }


def _rate_check(ip: str) -> bool:
    now = time.time()
    stale = [k for k, (ts, _) in _rate_state.items() if now - ts > _RATE_WINDOW]
    for k in stale:
        del _rate_state[k]
    ts, count = _rate_state.get(ip, (0, 0))
    if now - ts > _RATE_WINDOW:
        _rate_state[ip] = (now, 1)
        return True
    if count >= _RATE_MAX:
        return False
    _rate_state[ip] = (ts, count + 1)
    return True


def _client_ip(request: Request) -> str:
    # 与限流同一套取值策略（core.rate_limits.get_client_ip）——遥测限流同样不能被
    # 客户端伪造的 X-Forwarded-For 第一段绕过。
    return get_client_ip(request)


class ErrorItem(BaseModel):
    type: str = Field(default="", max_length=200)
    message: str = Field(default="", max_length=1000)
    url: str = Field(default="", max_length=500)
    user_id: int = Field(default=0)
    ua: str = Field(default="", max_length=200)
    source: str = Field(default="", max_length=120)
    component_stack: str = Field(default="", max_length=1000)


class TelemetryPayload(BaseModel):
    errors: list[ErrorItem] = Field(default_factory=list, max_length=_MAX_BATCH)


@router.post("", status_code=204)
async def ingest_telemetry(payload: TelemetryPayload, request: Request):
    """Ingest frontend error telemetry.  Always returns 204 (no content).

    Rate limited per IP: 5 requests per 60-second window.
    Max 20 errors per payload.
    """
    ip = _client_ip(request)
    if not _rate_check(ip):
        return
    buffer = getattr(request.app.state, "frontend_error_buffer", None)
    if buffer is None or not payload.errors:
        return
    entries = [e.model_dump() for e in payload.errors]
    types = sorted({e.type or "unknown" for e in payload.errors})[:5]
    log.info("Frontend telemetry ingest: count=%d ip=%s types=%s", len(entries), ip, types)
    buffer.ingest(*entries)
