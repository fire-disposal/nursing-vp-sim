"""Frontend telemetry buffer, shared archive, and ingest endpoint.

Telemetry is best-effort runtime infrastructure: it never blocks user requests and is exposed
through diagnostics snapshots.

进程模型：uvicorn 以 ``--workers 2`` 运行，每个 worker 有独立的进程内缓冲。只读进程内缓冲
会让 /api/diagnose 只看到一半遥测（2026-09-24 机房崩溃取证时，同一端点两次调用返回两套
互斥计数）。因此每个 worker 在去重后把错误增量落到共享 JSONL 归档
（``/app/data/diagnostics/frontend-errors.jsonl``，见 deploy/docker-compose.prod.yml 的卷），
快照时把「共享归档 + 本进程未落盘增量」合并，得到跨 worker 口径。

去重 / 归档 / 分组的实现与后端日志捕获共用 ``infra.error_buffer``（本模块只提供配置与投影）。
"""

from __future__ import annotations

import logging
import os
import time
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from core.rate_limits import get_client_ip
from infra.error_archive import ErrorArchive
from infra.error_buffer import BufferConfig, DedupArchiveBuffer, DedupEntry, ErrorGroup, aggregate, fingerprint

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/telemetry", tags=["遥测"])

_MSG_MAX = 1000
_MAX_BATCH = 20
_RATE_WINDOW = 60
_RATE_MAX = 5
# 前端遥测快照窗口（分钟）——诊断端点的 frontend_errors.window 标签由此派生。
SNAPSHOT_WINDOW_MINUTES = 60
_GROUPS_N = 20

_CONFIG = BufferConfig(
    archive_path=os.getenv("FRONTEND_ERROR_ARCHIVE", "/app/data/diagnostics/frontend-errors.jsonl"),
    archive_max_bytes=int(os.getenv("FRONTEND_ERROR_ARCHIVE_MAX_MB", "2")) * 1024 * 1024,
    archive_backups=int(os.getenv("FRONTEND_ERROR_ARCHIVE_BACKUPS", "2")),
    max_entries=2000,
    dedup_window=300,
    hash_head=120,
    query_limit=1000,
)

_rate_state: dict[str, tuple[float, int]] = {}


def _event(entry: DedupEntry, count: int, _source: str) -> dict:
    """归档 / 快照事件；``time`` 为最近一次发生时间（归档按它过滤窗口）。"""
    return {
        "fingerprint": entry.fingerprint,
        "time": datetime.fromtimestamp(entry.last_seen, tz=UTC).isoformat(),
        "first_seen": datetime.fromtimestamp(entry.first_seen, tz=UTC).isoformat(),
        **entry.payload,
        "count": count,
    }


def _fallback_fingerprint(event: dict) -> str:
    return fingerprint(
        str(event.get("source", "")),
        str(event.get("type", "")),
        message=str(event.get("message", "")),
        head=_CONFIG.hash_head,
    )


_archive: ErrorArchive | None = None
_archive_initialized = False


def get_frontend_error_archive() -> ErrorArchive | None:
    """共享归档单例；不可写时退化为纯进程内缓冲（遥测不能影响业务）。"""
    global _archive, _archive_initialized
    if not _archive_initialized:
        _archive_initialized = True
        _archive = _CONFIG.open_archive()
    return _archive


class FrontendErrorBuffer:
    """进程内去重缓冲 + 跨 worker 共享归档；快照不再按 worker 分裂。"""

    def __init__(self, archive: ErrorArchive | None = None):
        self.archive = archive if archive is not None else get_frontend_error_archive()
        self._buffer = DedupArchiveBuffer(_CONFIG, archive=self.archive, build_event=_event)

    def ingest(self, *entries: dict) -> None:
        """Ingest one or more error dicts from the telemetry endpoint."""
        now = time.time()
        for e in entries:
            error_type = str(e.get("type", "") or "")[:200]
            message = str(e.get("message", "") or "")[:_MSG_MAX]
            source = str(e.get("source", "") or "")[:120]
            payload = {
                "type": error_type,
                "message": message,
                "url": str(e.get("url", "") or "")[:500],
                "user_id": int(e.get("user_id", 0) or 0),
                "ua": str(e.get("ua", "") or "")[:200],
                "source": source,
                "component_stack": str(e.get("component_stack", "") or "")[:1000],
            }
            self._buffer.record(
                key=(source, error_type, message[: _CONFIG.hash_head]),
                fingerprint=fingerprint(source, error_type, message=message, head=_CONFIG.hash_head),
                payload=payload,
                now=now,
            )

    def aggregate_snapshot(self, *, window_minutes: int = SNAPSHOT_WINDOW_MINUTES, max_groups: int = _GROUPS_N) -> dict:
        """跨 worker 快照 = 本进程未落盘增量 + 共享归档。

        - ``last_5min`` / ``last_hour``：窗口内发生次数（含其它 worker 已归档的部分）
        - ``total_captured``：24h 内不同错误签名数（原为单进程缓冲长度，会按 worker 分裂）
        - ``groups``：窗口内按 last_seen 倒序的错误签名，带 ``ua``（出事端浏览器）
        """
        now = datetime.now(UTC)
        result = aggregate(
            self._buffer.merged_events(now - timedelta(days=1)),
            now,
            windows=_CONFIG.windows,
            fallback_fingerprint=_fallback_fingerprint,
        )
        cutoff = (now - timedelta(minutes=window_minutes)).isoformat()
        window = [group for group in result.groups.values() if group.last_seen >= cutoff]
        window.sort(key=lambda group: group.last_seen, reverse=True)
        return {**result.counts, "groups": [_project(group) for group in window[:max_groups]]}


def _project(group: ErrorGroup) -> dict:
    """分组投影：展示字段取最近一次事件（浏览器 / 页面 / 用户），计数为该指纹累计。"""
    event = group.latest_event
    return {
        "fingerprint": group.fingerprint,
        "type": str(event.get("type", "")),
        "message": str(event.get("message", "")),
        "url": str(event.get("url", "")),
        "user_id": int(event.get("user_id", 0) or 0),
        "ua": str(event.get("ua", "")),
        "source": str(event.get("source", "")),
        "component_stack": str(event.get("component_stack", "")),
        "count": group.count,
        "time": group.last_seen,
        "first_seen": group.first_seen,
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
