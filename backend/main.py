"""Virtual Patient Training System — FastAPI application entrypoint."""

import asyncio
import logging
import os
import textwrap
import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core.config import (
    APP_VERSION,
    LLM_CONNECTION_KEEPALIVE,
    LLM_CONNECTION_POOL_SIZE,
    REQUEST_TIMEOUT_SECONDS,
    log_config,
    validate_config,
)
from core.database import init_db
from core.exceptions import (
    AuthError,
    ConflictError,
    LLMError,
    NotFoundError,
    ScoringError,
    ValidationError,
    auth_error_handler,
    conflict_handler,
    llm_error_handler,
    not_found_handler,
    scoring_error_handler,
    validation_error_handler,
)
from infrastructure.llm import ProfileRouter
from infrastructure.logging_setup import setup_logging
from scripts.seed import seed_all

log = logging.getLogger(__name__)

NOTIFICATION_LOCK_KEY = 987654322

_MAX_REQUEST_BYTES = int(os.getenv("MAX_REQUEST_BYTES", str(10 * 1024 * 1024)))


BANNER = textwrap.dedent(r"""\
 ____             __                             ____    ____    
/\  _`\          /\ \                           /\  _`\ /\  _`\  
\ \ \/\_\  __  __\ \ \____     __   _ __        \ \,\L\_\ \ \L\ \
 \ \ \/_/_/\ \/\ \\ \ '__`\  /'__`\/\`'__\_______\/_\__ \\ \ ,__/
  \ \ \L\ \ \ \_\ \\ \ \L\ \/\  __/\ \ \//\______\ /\ \L\ \ \ \/ 
   \ \____/\/`____ \\ \_,__/\ \____\\ \_\\/______/ \ `\____\ \_\ 
    \/___/  `/___/> \\/___/  \/____/ \/_/           \/_____/\/_/ 
               /\___/                                            
               \/__/                                             
                                                                                                                     
""").strip()  # noqa: W291


def _recover_stuck_scoring_records():
    """Recover scoring records stuck in 'pending'/'processing' from a previous instance crash."""

    from core.database import SessionLocal
    from models import Score, TrainingRecord

    db = SessionLocal()
    try:
        stuck = (
            db.query(TrainingRecord)
            .filter(
                TrainingRecord.scoring_status.in_(["pending", "processing"]),
                TrainingRecord.status == "completed",
            )
            .all()
        )
        scored_ids = (
            {r[0] for r in db.query(Score.record_id).filter(Score.record_id.in_([rec.id for rec in stuck])).all()}
            if stuck
            else set()
        )
        for rec in stuck:
            if rec.id in scored_ids:
                rec.scoring_status = "completed"
                rec.scoring_error = None
            else:
                rec.scoring_status = "failed"
                rec.scoring_error = "服务重启导致评分中断，请点击重新评分"
        db.commit()
        if stuck:
            log.info(
                "恢复了 %d 条卡住的评分记录",
                len(stuck),
                extra={"count": len(stuck), "action": "scoring_recovery"},
            )
    except Exception:
        log.exception("恢复卡住的评分记录失败")
    finally:
        db.close()


def _warm_knowledge_base() -> None:
    """Index and warm knowledge base for QA. Non-fatal on failure."""
    try:
        from contexts.qa.knowledge_base.indexer import check_indexed, index_all

        count = check_indexed()
        if count == 0:
            log.info("Knowledge base empty, indexing textbooks...")
            n = index_all()
            log.info("Knowledge base indexed: %d chunks", n)
        else:
            log.info("Knowledge base ready: %d chunks", count)
    except Exception:
        log.exception("Knowledge base indexing failed (non-fatal)")

    try:
        from contexts.qa.knowledge_base.chapter_index import _ensure_index

        _ensure_index()
        log.info("Knowledge chapter index: ready")
    except Exception:
        log.exception("Chapter index warming failed (non-fatal)")


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    validate_config()

    log.info(msg=BANNER)
    log.info("──────────────────────────────────────────────")
    log.info("Animus Machinae excitus est.")
    log.info("机魂已唤醒")
    log.info("──────────────────────────────────────────────\n")
    log.info("虚拟患者训练系统 v%s", APP_VERSION)
    log_config(log)

    init_db()
    seed_all()
    log.info("Seeds: complete")

    _recover_stuck_scoring_records()
    log.info("Scoring recovery: done")

    _warm_knowledge_base()

    from core.rate_limits import PgRateLimiter

    app.state.rate_limiter = PgRateLimiter()

    app.state.httpx_client = httpx.AsyncClient(
        timeout=httpx.Timeout(120, connect=15.0),
        limits=httpx.Limits(
            max_connections=LLM_CONNECTION_POOL_SIZE,
            max_keepalive_connections=LLM_CONNECTION_KEEPALIVE,
            keepalive_expiry=120,
        ),
    )

    app.state.llm_router = ProfileRouter()

    from bootstrap import shutdown as bootstrap_shutdown
    from bootstrap import startup as bootstrap_startup

    await bootstrap_startup(app)
    yield
    await bootstrap_shutdown(app)


def _publish_pending_notifications() -> None:
    """Sync worker: deliver due system notifications to active users. Holds a Postgres
    advisory lock so only one process publishes. Safe to call repeatedly; never raises."""
    from sqlalchemy import insert, text

    from core.database import SessionLocal
    from models import Notification, SystemNotification, User

    db = SessionLocal()
    try:
        locked = db.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": NOTIFICATION_LOCK_KEY}).scalar()
        if not locked:
            return
        try:
            now = datetime.now(UTC)
            pending = (
                db.query(SystemNotification)
                .filter(
                    SystemNotification.is_active == True,
                    SystemNotification.published_at.isnot(None),
                    SystemNotification.published_at <= now,
                )
                .all()
            )
            if not pending:
                return
            user_ids = [r[0] for r in db.query(User.id).filter(User.is_active == True).all()]
            if not user_ids:
                # No recipients yet — keep notifications active so they deliver once users exist.
                log.warning("Notification publisher: %d pending but no active users; deferring", len(pending))
                return
            for sn in pending:
                db.execute(
                    insert(Notification).values(
                        [dict(user_id=uid, type="system", title=sn.title, body=sn.content) for uid in user_ids]
                    )
                )
                sn.is_active = False
                log.info("Notification published: %s -> %d users", sn.title, len(user_ids))
            db.commit()
        finally:
            try:
                db.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": NOTIFICATION_LOCK_KEY})
            except Exception:
                log.warning("Failed to release notification advisory lock", exc_info=True)
    except Exception:
        log.exception("Notification publisher error")
        db.rollback()
    finally:
        db.close()


async def _notification_publisher(interval: int = 60):
    """后台任务：定时检查 SystemNotification 是否到达发布时间，到达后推送到用户通知。"""
    while True:
        await asyncio.sleep(interval)
        await asyncio.to_thread(_publish_pending_notifications)


def _handle_task_exception(loop, ctx):
    msg = ctx.get("message", "")
    exc = ctx.get("exception")
    task_name = getattr(ctx.get("task"), "get_name", lambda: "?")() if ctx.get("task") else "?"
    log.error("asyncio task 异常 %s: %s | %s", task_name, msg, exc)


# ── Application ──

app = FastAPI(title="虚拟患者训练系统", version=APP_VERSION, lifespan=lifespan)


# ── Custom exception handlers (registered before the generic handler) ──

app.add_exception_handler(AuthError, auth_error_handler)  # ty: ignore[invalid-argument-type]
app.add_exception_handler(NotFoundError, not_found_handler)  # ty: ignore[invalid-argument-type]
app.add_exception_handler(ConflictError, conflict_handler)  # ty: ignore[invalid-argument-type]
app.add_exception_handler(ValidationError, validation_error_handler)  # ty: ignore[invalid-argument-type]
app.add_exception_handler(LLMError, llm_error_handler)  # ty: ignore[invalid-argument-type]
app.add_exception_handler(ScoringError, scoring_error_handler)  # ty: ignore[invalid-argument-type]


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    if isinstance(exc, HTTPException):
        raise exc
    log.exception("未处理异常 %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "服务器内部错误"})


@app.middleware("http")
async def _log_requests(request: Request, call_next):
    t0 = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        ms = int((time.perf_counter() - t0) * 1000)
        log.exception("%s %s → 500 (unhandled exception) [%dms]", request.method, request.url.path, ms)
        raise
    ms = int((time.perf_counter() - t0) * 1000)
    if response.status_code >= 500:
        log.error("%s %s → %d [%dms]", request.method, request.url.path, response.status_code, ms)
    elif response.status_code >= 400:
        log.warning("%s %s → %d [%dms]", request.method, request.url.path, response.status_code, ms)
    metrics = getattr(request.app.state, "metrics", None)
    if metrics and request.url.path not in ("/api/metrics", "/api/health"):
        metrics.record_request(response.status_code, ms)
    return response


@app.middleware("http")
async def _limit_body_size(request: Request, call_next):
    content_length = request.headers.get("content-length")
    transfer_encoding = request.headers.get("transfer-encoding", "").lower()
    if content_length:
        if int(content_length) > _MAX_REQUEST_BYTES:
            return JSONResponse(status_code=413, content={"detail": "请求体过大"})
    elif transfer_encoding == "chunked":
        body = await request.body()
        if len(body) > _MAX_REQUEST_BYTES:
            return JSONResponse(status_code=413, content={"detail": "请求体过大"})
    return await call_next(request)


@app.middleware("http")
async def _request_timeout(request: Request, call_next):
    if request.url.path.startswith("/api/chat/") and "stream" in request.url.path:
        return await call_next(request)

    try:
        return await asyncio.wait_for(call_next(request), timeout=REQUEST_TIMEOUT_SECONDS)
    except TimeoutError:
        log.error("请求超时 %s %s (limit=%ds)", request.method, request.url.path, REQUEST_TIMEOUT_SECONDS)
        return JSONResponse(status_code=504, content={"detail": "请求处理超时"})


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        o.strip()
        for o in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:8000").split(",")
        if o.strip()
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# EnvelopeMiddleware removed — API now returns standard JSON with HTTP status codes.

# Profile registration
from profiles.history_taking import PROFILE as _HISTORY_TAKING_PROFILE
from profiles.registry import register_profile

register_profile("history_taking", _HISTORY_TAKING_PROFILE)

# Tool registration
from contexts.training.tools import register_all

register_all()

# Route registration
from routers import register_routers

register_routers(app)
