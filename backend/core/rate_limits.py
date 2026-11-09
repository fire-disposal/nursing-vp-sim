"""PostgreSQL-backed sliding-window rate limiter for multi-worker safety."""

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import text

from core.database import SessionLocal

log = logging.getLogger(__name__)


class PgRateLimiter:
    """PostgreSQL-backed sliding-window rate limiter.
    Each is_allowed() call runs: DELETE expired + INSERT new + COUNT remaining in one transaction.
    """

    def _check_sync(self, key: str, max_requests: int, window_seconds: int) -> bool:
        db = SessionLocal()
        try:
            cutoff = datetime.now(UTC) - timedelta(seconds=window_seconds)
            db.execute(
                text("DELETE FROM rate_limit_entries WHERE key = :key AND created_at < :cutoff"),
                {"key": key, "cutoff": cutoff},
            )
            db.execute(
                text("INSERT INTO rate_limit_entries (key, created_at) VALUES (:key, :now)"),
                {"key": key, "now": datetime.now(UTC)},
            )
            result = db.execute(
                text("SELECT COUNT(*) FROM rate_limit_entries WHERE key = :key"),
                {"key": key},
            )
            count = result.scalar()
            if count > max_requests:
                db.commit()
                return False
            db.commit()
            return True
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    async def is_allowed(self, key: str, max_requests: int, window_seconds: int) -> bool:
        return await asyncio.to_thread(self._check_sync, key, max_requests, window_seconds)

    async def reset_key(self, key: str) -> None:
        def _reset():
            db = SessionLocal()
            try:
                db.execute(text("DELETE FROM rate_limit_entries WHERE key = :key"), {"key": key})
                db.commit()
            finally:
                db.close()

        await asyncio.to_thread(_reset)


def get_rate_limiter(request: Request) -> "PgRateLimiter":
    return request.app.state.rate_limiter


def get_client_ip(request: Request) -> str:
    """真实客户端 IP 的唯一取值策略（限流/遥测共用一个实现）。

    信任模型：只有反向代理（nginx）写入的头才可信，客户端自带值必须被覆盖。

    - ``X-Real-IP``：nginx 用 ``proxy_set_header X-Real-IP $remote_addr`` **覆盖**写入，
      最可信，优先取用；
    - ``X-Forwarded-For``：nginx 用 ``$proxy_add_x_forwarded_for`` **追加**真实对端地址，
      因此最后一个元素才是代理写入的，取尾段；
    - **绝不取 XFF 第一段**——那是客户端可以随意伪造的值，用它做限流键等于限流失效
      （每次换一个伪造 IP 就得到一个新的 ``login:{ip}`` 桶）。

    直连（无代理）时回退到 socket 对端地址。
    """
    real_ip = request.headers.get("X-Real-IP", "").strip()
    if real_ip:
        return real_ip
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        hops = [hop.strip() for hop in forwarded.split(",") if hop.strip()]
        if hops:
            return hops[-1]
    return request.client.host if request.client else "unknown"


async def login_rate_limit(request: Request, limiter: Annotated["PgRateLimiter", Depends(get_rate_limiter)]):
    key = f"login:{get_client_ip(request)}"
    if not await limiter.is_allowed(key, max_requests=10, window_seconds=300):
        log.warning("login rate limit: ip=%s", get_client_ip(request))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="登录尝试过于频繁，请 5 分钟后再试",
        )


async def register_rate_limit(request: Request, limiter: Annotated["PgRateLimiter", Depends(get_rate_limiter)]):
    key = f"register:{get_client_ip(request)}"
    if not await limiter.is_allowed(key, max_requests=5, window_seconds=60):
        log.warning("register rate limit: ip=%s", get_client_ip(request))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="注册请求过于频繁，请稍后再试",
        )


async def check_chat_limit(user_id: int, request: Request):
    limiter: PgRateLimiter = request.app.state.rate_limiter
    key = f"chat:{user_id}"
    if not await limiter.is_allowed(key, max_requests=6, window_seconds=60):
        log.warning("chat rate limit: user_id=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="消息发送过于频繁，请稍后再试",
        )


async def check_qa_limit(user_id: int, request: Request):
    limiter: PgRateLimiter = request.app.state.rate_limiter
    key = f"qa:{user_id}"
    if not await limiter.is_allowed(key, max_requests=5, window_seconds=60):
        log.warning("qa rate limit: user_id=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="提问过于频繁，请稍后再试",
        )


async def check_tts_limit(user_id: int, request: Request):
    limiter: PgRateLimiter = request.app.state.rate_limiter
    key = f"tts:{user_id}"
    # Sentence-granularity streaming fans out ~3-5 requests per chat reply.
    if not await limiter.is_allowed(key, max_requests=60, window_seconds=60):
        log.warning("tts rate limit: user_id=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="TTS 合成请求过于频繁，请稍后再试",
        )


async def reset_login_limit(request: Request):
    limiter: PgRateLimiter = request.app.state.rate_limiter
    key = f"login:{get_client_ip(request)}"
    await limiter.reset_key(key)
