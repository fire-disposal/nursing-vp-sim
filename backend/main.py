"""Virtual Patient Training System — FastAPI application entrypoint."""

import asyncio
import logging
import os
import textwrap
import threading
import time
from contextlib import asynccontextmanager, suppress

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

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
from core.envelope import EnvelopeMiddleware
from core.logging_setup import setup_logging
from core.seed import seed_all
from infrastructure.cache import EmotionCache, InitiativeCache
from infrastructure.llm import LogWorker, ProfileRouter
from infrastructure.llm.client import LLMClient
from infrastructure.metrics import MetricsSnapshot
from infrastructure.prompt import PromptManager
from infrastructure.queue import TaskQueue
from infrastructure.settlement import settlement_loop
from middleware.rate_limits import RateLimiter
from repositories.training import TrainingRepository

log = logging.getLogger(__name__)

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
                                                                                                                     
""").strip()# noqa: W291 

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

    app.state.rate_limiter = RateLimiter()

    app.state.httpx_client = httpx.AsyncClient(
        timeout=httpx.Timeout(120, connect=15.0),
        limits=httpx.Limits(
            max_connections=LLM_CONNECTION_POOL_SIZE,
            max_keepalive_connections=LLM_CONNECTION_KEEPALIVE,
            keepalive_expiry=30,
        ),
    )

    app.state.llm_router = ProfileRouter()
    await app.state.llm_router.load_from_db()
    log.info("Profile router: ready")

    app.state.prompt_manager = PromptManager()
    await app.state.prompt_manager.load_from_db()
    log.info("Prompt manager: ready")

    app.state.log_worker = LogWorker(
        overflow_dir=LLM_LOG_OVERFLOW_DIR,
        overflow_max_size_mb=LLM_LOG_OVERFLOW_MAX_SIZE_MB,
        overflow_max_files=LLM_LOG_OVERFLOW_MAX_FILES,
    )
    await app.state.log_worker.start()

    app.state.task_queue = TaskQueue(max_workers=3)
    await app.state.task_queue.start()
    log.info("Task queue: 3 workers")

    app.state.emotion_cache = EmotionCache()
    app.state.initiative_cache = InitiativeCache()

    from contexts.training.plugins import register_all_plugins

    register_all_plugins()
    log.info("Plugins: registered")

    metrics = MetricsSnapshot()
    app.state.metrics = metrics

    metrics.active_sessions_supplier = lambda: len(app.state.emotion_cache.all_ids) if app.state.emotion_cache else 0
    metrics.task_queue_size_supplier = lambda: app.state.task_queue.pending if app.state.task_queue else 0
    metrics.log_queue_size_supplier = lambda: (
        app.state.log_worker._queue.qsize() if app.state.log_worker and app.state.log_worker._queue else 0
    )
    metrics.degraded_providers_supplier = lambda: app.state.llm_router.degraded_count() if app.state.llm_router else 0
    metrics.global_degraded_supplier = lambda: app.state.llm_router.global_degraded if app.state.llm_router else False

    app.state.llm_client = LLMClient(
        http=app.state.httpx_client,
        router=app.state.llm_router,
        log_worker=app.state.log_worker,
        metrics=metrics,
    )

    background_loop = asyncio.new_event_loop()
    background_thread = threading.Thread(target=background_loop.run_forever, daemon=False, name="bg-loop")
    background_thread.start()
    app.state._background_loop = background_loop
    app.state._background_thread = background_thread
    set_training_infra(
        app.state.httpx_client, app.state.llm_router, app.state.prompt_manager, app.state.log_worker, background_loop
    )

    cleanup_task = asyncio.create_task(_rate_limiter_cleanup(app.state.rate_limiter))
    app.state._cleanup_task = cleanup_task

    settlement_task = asyncio.create_task(
        settlement_loop(
            repo=TrainingRepository(),
            task_queue=app.state.task_queue,
            llm_client=app.state.llm_client,
            pm=app.state.prompt_manager,
            interval=CLEANUP_INTERVAL_SECONDS,
            emotion_cache=app.state.emotion_cache,
            initiative_cache=app.state.initiative_cache,
        )
    )
    app.state._settlement_task = settlement_task
    log.info("Settlement: started (interval=%ds)", CLEANUP_INTERVAL_SECONDS)

    _loop = asyncio.get_running_loop()
    _loop.set_exception_handler(_handle_task_exception)

    log.info("──────────────────────────────────────────────")
    log.info("Fiat Lux Machinae.")
    log.info("让机械之光成就")
    log.info("──────────────────────────────────────────────")
    log.info("Ready")
    yield

    # Shutdown
    cleanup_task.cancel()
    with suppress(asyncio.CancelledError):
        await cleanup_task
    settlement_task.cancel()
    with suppress(asyncio.CancelledError):
        await settlement_task
    await app.state.task_queue.stop()
    await app.state.log_worker.stop()
    if app.state.httpx_client:
        await app.state.httpx_client.aclose()
    await asyncio.to_thread(engine.dispose)
    await asyncio.to_thread(stop_background_loop)


async def _rate_limiter_cleanup(rate_limiter: RateLimiter):
    while True:
        await asyncio.sleep(600)
        await rate_limiter.cleanup()


def _handle_task_exception(loop, ctx):
    msg = ctx.get("message", "")
    exc = ctx.get("exception")
    task_name = getattr(ctx.get("task"), "get_name", lambda: "?")() if ctx.get("task") else "?"
    log.error("asyncio task 异常 %s: %s | %s", task_name, msg, exc)


# ── Application ──

app = FastAPI(title="虚拟患者训练系统", version=APP_VERSION, lifespan=lifespan)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    if isinstance(exc, HTTPException):
        raise exc
    log.error("未处理异常 %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(status_code=500, content={"detail": "服务器内部错误"})


@app.middleware("http")
async def _log_requests(request: Request, call_next):
    t0 = time.perf_counter()
    response = await call_next(request)
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
    if content_length and int(content_length) > _MAX_REQUEST_BYTES:
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
app.add_middleware(EnvelopeMiddleware)

# Route registration
from contexts.qa import router as qa_router
from contexts.training import chat_router, nursing_router, training_router
from routers import (
    admin,
    admin_classes,
    admin_grades,
    auth,
    cases,
    export,
    feedback,
    notes,
    questionnaires,
    stats,
)
from routers.admin.plugins import router as admin_plugins_router
from routers.admin.practices import router as admin_practices_router
from routers.admin_api import router as admin_api_router
from routers.admin_prompts import router as admin_prompts_router
from routers.admin_roles import router as admin_roles_router
from routers.admin_schools import router as admin_schools_router
from routers.assignments import router as assignments_router
from routers.assignments import student_router as student_assignments_router

for mod in [auth, admin, admin_classes, admin_grades, cases, export, feedback, notes, questionnaires, stats]:
    app.include_router(mod.router)
app.include_router(admin_api_router)
app.include_router(admin_prompts_router)
app.include_router(admin_plugins_router)
app.include_router(admin_practices_router)
app.include_router(admin_schools_router)
app.include_router(admin_roles_router)
app.include_router(training_router)
app.include_router(chat_router)
app.include_router(nursing_router)
app.include_router(qa_router)
app.include_router(assignments_router)
app.include_router(student_assignments_router)


@app.get("/api/health")
async def health():
    from core.database import engine

    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse(
            status_code=503,
            content={"code": 503, "data": {"status": "db_error"}, "message": "database unreachable"},
        )
    return {"status": "ok", "version": APP_VERSION}


@app.get("/api/metrics")
async def metrics(request: Request):
    m = request.app.state.metrics
    return m.snapshot()
