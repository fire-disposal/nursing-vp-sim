"""Frontend telemetry buffer and ingest endpoint.

Telemetry is best-effort runtime infrastructure: it never blocks user requests and is exposed
through diagnostics snapshots.
"""

from __future__ import annotations

import logging
import time
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/telemetry", tags=["遥测"])

_MAX_ERRORS = 2000
_DEDUP_WINDOW = 300
_DEDUP_HASH_HEAD = 120
_RECENT_N = 20
_MSG_MAX = 1000
_MAX_BATCH = 20
_RATE_WINDOW = 60
_RATE_MAX = 5

_rate_state: dict[str, tuple[float, int]] = {}


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


class FrontendErrorBuffer:
    """Thread-safe enough in-memory ring buffer for process-local frontend errors."""

    def __init__(self):
        self.buffer: deque[FrontendErrorEntry] = deque(maxlen=_MAX_ERRORS)
        self._dedup: dict[tuple[str, str, str], tuple[float, int]] = {}

    def _dedup_key(self, source: str, error_type: str, message: str) -> tuple[str, str, str]:
        return (source, error_type, message[:_DEDUP_HASH_HEAD])

    def _prune_dedup(self, now: float) -> None:
        stale = [k for k, (ts, _) in self._dedup.items() if now - ts > _DEDUP_WINDOW]
        for k in stale:
            del self._dedup[k]

    def ingest(self, *entries: dict) -> None:
        """Ingest one or more error dicts from the telemetry endpoint."""
        now = time.time()
        self._prune_dedup(now)
        for e in entries:
            error_type = str(e.get("type", "") or "")[:200]
            message = str(e.get("message", "") or "")[:_MSG_MAX]
            url = str(e.get("url", "") or "")[:500]
            user_id = int(e.get("user_id", 0) or 0)
            ua = str(e.get("ua", "") or "")[:200]
            source = str(e.get("source", "") or "")[:120]
            component_stack = str(e.get("component_stack", "") or "")[:1000]

            key = self._dedup_key(source, error_type, message)
            if key in self._dedup:
                _, count = self._dedup[key]
                self._dedup[key] = (now, count + 1)
                for entry in reversed(self.buffer):
                    if (
                        entry.source == source
                        and entry.error_type == error_type
                        and entry.message[:_DEDUP_HASH_HEAD] == message[:_DEDUP_HASH_HEAD]
                    ):
                        entry.count = count + 1
                        entry.timestamp = now
                        break
                continue
            self._dedup[key] = (now, 1)
            self.buffer.append(
                FrontendErrorEntry(
                    time=datetime.now(UTC).isoformat(),
                    error_type=error_type,
                    message=message,
                    url=url,
                    user_id=user_id,
                    ua=ua,
                    source=source,
                    component_stack=component_stack,
                    timestamp=now,
                )
            )

    def get_recent(self, n: int = _RECENT_N) -> list[dict]:
        entries = list(self.buffer)[-n:]
        return [
            {
                "time": e.time,
                "type": e.error_type,
                "message": e.message,
                "url": e.url,
                "user_id": e.user_id,
                "count": e.count,
                "source": e.source,
                "component_stack": e.component_stack,
            }
            for e in entries
        ]

    @property
    def error_count_last_hour(self) -> int:
        cutoff = time.time() - 3600
        return sum(e.count for e in self.buffer if e.timestamp >= cutoff)

    @property
    def error_count_last_5min(self) -> int:
        cutoff = time.time() - 300
        return sum(e.count for e in self.buffer if e.timestamp >= cutoff)

    @property
    def total_captured(self) -> int:
        return len(self.buffer)

    def snapshot(self) -> dict:
        return {
            "last_5min": self.error_count_last_5min,
            "last_hour": self.error_count_last_hour,
            "total_captured": self.total_captured,
            "recent": self.get_recent(),
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
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


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
