import asyncio
import logging
import time
from collections import defaultdict
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status

log = logging.getLogger(__name__)


# ── RateLimiter 类 ──

class RateLimiter:
    def __init__(self):
        self._lock = asyncio.Lock()
        self._store: dict[str, list[float]] = defaultdict(list)

    async def is_allowed(self, key: str, max_requests: int, window_seconds: int) -> bool:
        now = time.time()
        cutoff = now - window_seconds
        async with self._lock:
            bucket = self._store[key]
            self._store[key] = [t for t in bucket if t > cutoff]
            if len(self._store[key]) >= max_requests:
                return False
            self._store[key].append(now)
            return True

    async def reset_key(self, key: str):
        async with self._lock:
            self._store.pop(key, None)

    async def cleanup(self, max_age_seconds: int = 600):
        now = time.time()
        cutoff = now - max_age_seconds
        async with self._lock:
            stale = [k for k, v in self._store.items() if not any(t > cutoff for t in v)]
            for k in stale:
                del self._store[k]


# ── DI 工厂 ──

def get_rate_limiter(request: Request) -> RateLimiter:
    return request.app.state.rate_limiter


# ── 限流 Depends ──

def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("X-Real-IP", "")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else "unknown"


async def login_rate_limit(request: Request, limiter: Annotated[RateLimiter, Depends(get_rate_limiter)]):
    key = f"login:{_get_client_ip(request)}"
    if not await limiter.is_allowed(key, max_requests=10, window_seconds=300):
        ip = _get_client_ip(request)
        log.warning("login rate limit: ip=%s", ip)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="登录尝试过于频繁，请 15 分钟后再试",
        )


async def register_rate_limit(request: Request, limiter: Annotated[RateLimiter, Depends(get_rate_limiter)]):
    key = f"register:{_get_client_ip(request)}"
    if not await limiter.is_allowed(key, max_requests=5, window_seconds=60):
        ip = _get_client_ip(request)
        log.warning("register rate limit: ip=%s", ip)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="注册请求过于频繁，请稍后再试",
        )


async def check_chat_limit(user_id: int, request: Request):
    limiter: RateLimiter = request.app.state.rate_limiter
    key = f"chat:{user_id}"
    if not await limiter.is_allowed(key, max_requests=6, window_seconds=60):
        log.warning("chat rate limit: user_id=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="消息发送过于频繁，请稍后再试",
        )


async def check_qa_limit(user_id: int, request: Request):
    limiter: RateLimiter = request.app.state.rate_limiter
    key = f"qa:{user_id}"
    if not await limiter.is_allowed(key, max_requests=5, window_seconds=60):
        log.warning("qa rate limit: user_id=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="提问过于频繁，请稍后再试",
        )


async def reset_login_limit(request: Request):
    limiter: RateLimiter = request.app.state.rate_limiter
    key = f"login:{_get_client_ip(request)}"
    await limiter.reset_key(key)
