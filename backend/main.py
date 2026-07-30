"""Virtual Patient Training System — FastAPI application entrypoint."""

import asyncio
import logging
import os
import textwrap
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core.config import (
    APP_VERSION,
    CORS_ORIGINS,
    LLM_CONNECTION_KEEPALIVE,
    LLM_CONNECTION_POOL_SIZE,
    MAX_REQUEST_BYTES,
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
    register_exception_handler,
    scoring_error_handler,
    validation_error_handler,
)
from infra.llm import ProfileRouter
from infra.logging_setup import setup_logging
from seed import seed_all

log = logging.getLogger(__name__)

_MAX_REQUEST_BYTES = MAX_REQUEST_BYTES


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
                rec.scoring_status = "pending"
                rec.scoring_error = None
        db.commit()
        if stuck:
            log.info(
                "恢复了 %d 条卡住的评分记录（已置为 pending，等待重试）",
                len(stuck),
                extra={"count": len(stuck), "action": "scoring_recovery"},
            )
    except Exception:
        log.exception("恢复卡住的评分记录失败")
    finally:
        db.close()


async def _re_enqueue_pending_scoring(app: FastAPI) -> None:
    """Re-enqueue scoring for records left in 'pending' state by startup recovery."""
    from core.database import SessionLocal
    from models import Case, TrainingRecord

    db = SessionLocal()
    try:
        pending = (
            db.query(TrainingRecord)
            .filter(
                TrainingRecord.scoring_status == "pending",
                TrainingRecord.status == "completed",
            )
            .all()
        )
        if not pending:
            return

        task_queue = getattr(app.state, "task_queue", None)
        if task_queue is None:
            log.warning("TaskQueue not ready, %d pending scoring records will retry on next restart", len(pending))
            return

        enqueued = 0
        for record in pending:
            case = db.query(Case).filter(Case.id == record.case_id).first()
            case_data = record.case_snapshot or (case.case_data if case else {})
            try:
                from modules.training.router.scoring import _run_scoring_background

                await task_queue.enqueue(
                    lambda rid=record.id, cd=case_data: _run_scoring_background(
                        rid,
                        cd,
                        llm_client=app.state.llm_client,
                        tracker=getattr(app.state, "scoring_tracker", None),
                        realtime_hub=app.state.realtime_hub,
                    ),
                    priority=5,
                )
                enqueued += 1
            except Exception:
                log.exception("Failed to re-enqueue scoring for record_id=%d", record.id)

        if enqueued:
            log.info("Re-enqueued %d pending scoring records after restart", enqueued)
    except Exception:
        log.exception("Failed to re-enqueue pending scoring records")
    finally:
        db.close()


def _warm_knowledge_base() -> None:
    """Index and warm knowledge base for QA. Non-fatal on failure."""
    try:
        from modules.qa.knowledge_base.indexer import check_indexed, index_all

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
        from modules.qa.knowledge_base.chapter_index import _ensure_index

        _ensure_index()
        log.info("Knowledge chapter index: ready")
    except Exception:
        log.exception("Chapter index warming failed (non-fatal)")


def _validate_prompt_templates(logger) -> None:
    """Check all prompt templates against their TypedDict contracts at startup.

    Non-fatal — logs warnings for mismatches so placeholder drift is caught
    on deploy rather than silently producing ``{#unresolved#}`` at runtime.
    """
    try:
        from core.template_variables import validate_all_templates

        warnings = validate_all_templates()
        if warnings:
            for w in warnings:
                logger.warning("Prompt template contract mismatch: %s", w)
        else:
            logger.info("Prompt templates: all contracts verified")
    except Exception:
        logger.exception("Prompt template validation failed (non-fatal)")

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

    _validate_prompt_templates(log)

    init_db()
    if os.getenv("SKIP_SEED") == "1":
        log.info("Seeds: 跳过（SKIP_SEED=1）")
    else:
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

    try:
        app.state.llm_router = ProfileRouter()
    except Exception:
        log.exception("LLM ProfileRouter 初始化失败 — LLM 功能不可用")
        app.state.llm_router = None

    from infra.bootstrap import shutdown as bootstrap_shutdown
    from infra.bootstrap import startup as bootstrap_startup

    await bootstrap_startup(app)
    # Re-enqueue scoring for records recovered as 'pending' on startup
    await _re_enqueue_pending_scoring(app)
    yield
    await bootstrap_shutdown(app)


def _handle_task_exception(loop, ctx):
    msg = ctx.get("message", "")
    exc = ctx.get("exception")
    task_name = getattr(ctx.get("task"), "get_name", lambda: "?")() if ctx.get("task") else "?"
    log.error("asyncio task 异常 %s: %s | %s", task_name, msg, exc)


# ── Application ──

app = FastAPI(title="虚拟患者训练系统", version=APP_VERSION, lifespan=lifespan)


# ── Domain exception handlers ──

register_exception_handler(app, AuthError, auth_error_handler)
register_exception_handler(app, NotFoundError, not_found_handler)
register_exception_handler(app, ConflictError, conflict_handler)
register_exception_handler(app, ValidationError, validation_error_handler)
register_exception_handler(app, LLMError, llm_error_handler)
register_exception_handler(app, ScoringError, scoring_error_handler)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    log.error(
        "未处理异常 %s %s",
        request.method,
        request.url.path,
        exc_info=(type(exc), exc, exc.__traceback__),
    )
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
        metrics.record_request(response.status_code, ms, method=request.method, path=request.url.path)
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
        for o in CORS_ORIGINS.split(",")
        if o.strip()
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# EnvelopeMiddleware removed — API now returns standard JSON with HTTP status codes.


# Tool registration
from modules.training.tools import register_all

register_all()

# Route registration
from infra.diagnostics import router as _diagnostics
from infra.telemetry import router as _telemetry
from modules.admin import get_top_level_routers
from modules.admin import router as _admin
from modules.assignments import router as _assignments
from modules.assignments import student_router as _assignments_student
from modules.auth.router import router as _auth
from modules.cases.router import router as _cases
from modules.feedback.router import router as _feedback
from modules.qa import router as _qa
from modules.questionnaires.router import router as _questionnaires
from modules.training import chat_router as _chat
from modules.training import training_router as _training
from modules.voice.router import router as _tts

_exports, _profiles, _rubrics, _stats = get_top_level_routers()
for r in (_admin, _assignments, _assignments_student, _auth, _cases, _chat,
          _diagnostics, _exports, _feedback, _profiles, _qa, _questionnaires,
          _rubrics, _stats, _telemetry, _training, _tts):
    app.include_router(r)
