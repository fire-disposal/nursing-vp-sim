"""Frontend error telemetry endpoint — lightweight, zero-auth POST.

Payload: JSON array of error objects.
Example: [{"type":"AbortError","message":"请求超时，请重试","url":"/api/chat/...","user_id":50,"ua":"Chrome/131"}]

Rate-limited per IP (5 req/min) + hard cap batch size (20).
Fire-and-forget: always returns 204, never blocks the caller.
"""

import logging
import time

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/telemetry", tags=["遥测"])

_MAX_BATCH = 20  # 单次最多接收的错误数
_RATE_WINDOW = 60  # 限流窗口秒数
_RATE_MAX = 5  # 每窗口最大请求数

# 轻量 IP 限流器（进程内 dict + 惰性清理，独立于 PG rate limiter）
_rate_state: dict[str, tuple[float, int]] = {}


def _rate_check(ip: str) -> bool:
    """Return True if allowed, False if rate limited."""
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
        return  # silently drop
    buffer = getattr(request.app.state, "frontend_error_buffer", None)
    if buffer is None:
        return
    if not payload.errors:
        return
    entries = [e.model_dump() for e in payload.errors]
    buffer.ingest(*entries)
