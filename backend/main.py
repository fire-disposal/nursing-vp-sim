"""Virtual Patient Training System — FastAPI application entrypoint."""

import asyncio
import logging
import os
import textwrap
import threading
import time
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from contexts.training.router.session import set_training_infra, stop_background_loop
from core.config import (
    APP_VERSION,
    CLEANUP_INTERVAL_SECONDS,
    LLM_CONNECTION_KEEPALIVE,
    LLM_CONNECTION_POOL_SIZE,
    LLM_LOG_OVERFLOW_DIR,
    LLM_LOG_OVERFLOW_MAX_FILES,
    LLM_LOG_OVERFLOW_MAX_SIZE_MB,
    REQUEST_TIMEOUT_SECONDS,
    log_config,
    validate_config,
)
from core.database import engine, init_db
from core.diagnose import get_diagnose_service
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
from core.logging_setup import setup_logging
from core.seed import seed_all
from infrastructure.cache import EmotionCache, InitiativeCache
from infrastructure.llm import LogWorker, ProfileRouter
from infrastructure.llm.client import LLMClient
from infrastructure.metrics import MetricsSnapshot
from infrastructure.queue import TaskQueue
from infrastructure.scoring_progress import ScoringProgressTracker
from infrastructure.settlement import settlement_loop
from middleware.rate_limits import PgRateLimiter
from repositories.training import TrainingRepository

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
        scored_ids = {
            r[0]
            for r in db.query(Score.record_id)
            .filter(Score.record_id.in_([rec.id for rec in stuck]))
            .all()
        } if stuck else set()
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    validate_config()

    log.info(msg=BANNER)
    log.info("──────────────────────────────────────────────")
    log.info("Animus Machinae excitus est.")
    log.info("机魂已唤醒")
    log.info("──────────────────────────────────────────────")
    log.info("")
    log.info("虚拟患者训练系统 v%s", APP_VERSION)
    log_config(log)

    init_db()

    seed_all()
    log.info("Seeds: complete")

    _recover_stuck_scoring_records()

    log.info("Scoring recovery: done")

    if True:  # Always ensure knowledge base is indexed, RAG availability is per-request
        try:
            from infrastructure.rag.indexer import check_indexed, index_all

            count = check_indexed()
            if count == 0:
                log.info("Knowledge base empty, indexing textbooks...")
                n = index_all()
                log.info("Knowledge base indexed: %d chunks", n)
            else:
                log.info("Knowledge base ready: %d chunks", count)
        except Exception:
            log.exception("Knowledge base indexing failed (non-fatal)")

    # Warm knowledge base chapter index for QA
    try:
        from infrastructure.rag.chapter_index import _ensure_index

        _ensure_index()
        log.info("Knowledge chapter index: ready")
    except Exception:
        log.exception("Chapter index warming failed (non-fatal)")

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
    await app.state.llm_router.load_from_db()
    log.info("Profile router: ready")

    app.state.log_worker = LogWorker(
        overflow_dir=LLM_LOG_OVERFLOW_DIR,
        overflow_max_size_mb=LLM_LOG_OVERFLOW_MAX_SIZE_MB,
        overflow_max_files=LLM_LOG_OVERFLOW_MAX_FILES,
    )
    await app.state.log_worker.start()

    app.state.task_queue = TaskQueue(max_workers=3)
    await app.state.task_queue.start()
    log.info("Task queue: 3 workers")

    from infrastructure.realtime_hub import RealtimeHub

    app.state.emotion_cache = EmotionCache()
    app.state.initiative_cache = InitiativeCache()
    app.state.scoring_tracker = ScoringProgressTracker()
    app.state.realtime_hub = RealtimeHub()

    metrics = MetricsSnapshot()
    app.state.metrics = metrics

    metrics.active_sessions_supplier = lambda: len(app.state.emotion_cache.all_ids) if app.state.emotion_cache else 0
    metrics.task_queue_size_supplier = lambda: app.state.task_queue.pending if app.state.task_queue else 0
    metrics.log_queue_size_supplier = lambda: (
        app.state.log_worker._queue.qsize() if app.state.log_worker and app.state.log_worker._queue else 0
    )
    metrics.degraded_providers_supplier = lambda: app.state.llm_router.degraded_count() if app.state.llm_router else 0
    metrics.global_degraded_supplier = lambda: app.state.llm_router.global_degraded if app.state.llm_router else False

    # Diagnose service — install error capture handler
    diagnose_svc = get_diagnose_service()
    diagnose_svc.install_handler()
    diagnose_svc.set_app(app)

    app.state.llm_client = LLMClient(
        http=app.state.httpx_client,
        router=app.state.llm_router,
        log_worker=app.state.log_worker,
        metrics=metrics,
    )

    # ASR (v3) is opened per-connection by the /api/asr/stream proxy, so there
    # is no long-lived singleton client. Keep the attribute defined for safety.
    app.state.asr_client = None

    try:
        from core.database import SessionLocal
        from services.tts import load_tts_state

        db_voice = SessionLocal()
        try:
            load_tts_state(app.state, db_voice)
        finally:
            db_voice.close()
    except Exception:
        app.state.tts_client = None
        app.state.tts_config = {}
        log.exception("TTS client init failed (non-fatal)")

    background_loop = asyncio.new_event_loop()
    background_thread = threading.Thread(target=background_loop.run_forever, daemon=False, name="bg-loop")
    background_thread.start()
    app.state._background_loop = background_loop
    app.state._background_thread = background_thread
    set_training_infra(app.state.httpx_client, app.state.llm_router, app.state.log_worker, background_loop)

    async def _enqueue_settlement_scoring(record_id: int, case_data: dict) -> None:
        from contexts.training.router.scoring import _run_scoring_background

        await app.state.task_queue.enqueue(
            lambda rid=record_id, cd=case_data: _run_scoring_background(
                rid,
                cd,
                llm_client=app.state.llm_client,
                realtime_hub=app.state.realtime_hub,
            ),
            priority=6,
        )

    settlement_task = asyncio.create_task(
        settlement_loop(
            repo=TrainingRepository(),
            interval=CLEANUP_INTERVAL_SECONDS,
            enqueue_scoring=_enqueue_settlement_scoring,
        )
    )
    app.state._settlement_task = settlement_task
    log.info("Settlement: started (interval=%ds)", CLEANUP_INTERVAL_SECONDS)

    notif_task = asyncio.create_task(_notification_publisher(interval=60))
    app.state._notification_task = notif_task
    log.info("Notification publisher: started (interval=60s)")

    _loop = asyncio.get_running_loop()
    _loop.set_exception_handler(_handle_task_exception)

    log.info("──────────────────────────────────────────────")
    log.info("Fiat Lux Machinae.")
    log.info("让机械之光成就")
    log.info("──────────────────────────────────────────────")
    log.info("Ready")
    yield

    # Shutdown
    settlement_task.cancel()
    with suppress(asyncio.CancelledError):
        await settlement_task
    notif_task.cancel()
    with suppress(asyncio.CancelledError):
        await notif_task
    await app.state.task_queue.stop()
    await app.state.log_worker.stop()
    if app.state.httpx_client:
        await app.state.httpx_client.aclose()
    await asyncio.to_thread(engine.dispose)
    await asyncio.to_thread(stop_background_loop)


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
from profiles.triage import PROFILE as _TRIAGE_PROFILE

register_profile("history_taking", _HISTORY_TAKING_PROFILE)
register_profile("triage", _TRIAGE_PROFILE)

# Route registration
from routers import register_routers

register_routers(app)
