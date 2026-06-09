"""Virtual Patient Training System — FastAPI application entrypoint."""

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager, suppress

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from core.config import (
    APP_VERSION,
    CLEANUP_INTERVAL_SECONDS,
    LLM_CONNECTION_KEEPALIVE,
    LLM_CONNECTION_POOL_SIZE,
    log_config,
    validate_config,
)
from core.database import engine, get_db, init_db
from core.logging_setup import setup_logging
from core.seed import seed_all
from core.envelope import EnvelopeMiddleware
from infrastructure.cache import EmotionCache, InitiativeCache
from infrastructure.llm.client import LLMClient
from infrastructure.queue import TaskQueue
from middleware.rate_limits import RateLimiter
from repositories.training import TrainingRepository
from infrastructure.llm import LogWorker, ProfileRouter
from infrastructure.prompt import PromptManager
from contexts.training.service import settlement_loop

log = logging.getLogger(__name__)

_MAX_REQUEST_BYTES = int(os.getenv("MAX_REQUEST_BYTES", str(10 * 1024 * 1024)))


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    validate_config()
    log.info("虚拟患者训练系统 v%s", APP_VERSION)
    log_config(log)

    init_db()
    log.info("Database: migrations complete")

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

    app.state.log_worker = LogWorker()
    await app.state.log_worker.start()

    app.state.llm_client = LLMClient(
        http=app.state.httpx_client,
        router=app.state.llm_router,
        log_worker=app.state.log_worker,
    )

    app.state.task_queue = TaskQueue(max_workers=3)
    await app.state.task_queue.start()
    log.info("Task queue: 3 workers")

    app.state.emotion_cache = EmotionCache()
    app.state.initiative_cache = InitiativeCache()

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
    log.info("Animus Machinae excitus est.")
    log.info("──────────────────────────────────────────────")
    log.info("Ready")
    yield

    # Shutdown
    log.info("熄火之礼已成，机械长眠")
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
    log.info("机魂安息，虽眠犹侍万机神")


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
    return response


@app.middleware("http")
async def _limit_body_size(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > _MAX_REQUEST_BYTES:
        return JSONResponse(status_code=413, content={"detail": "请求体过大"})
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:8000").split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(EnvelopeMiddleware)

# Route registration
from routers import (
    admin, admin_classes, admin_grades, auth, cases,
    export, feedback, notes, questionnaires, stats,
)
from routers.admin.scenarios import router as admin_scenarios_router
from routers.admin.plugins import router as admin_plugins_router
from routers.admin_api import router as admin_api_router
from routers.admin_prompts import router as admin_prompts_router
from routers.admin_roles import router as admin_roles_router
from routers.admin_schools import router as admin_schools_router
from contexts.training import chat_router, nursing_router, training_router
from contexts.qa import router as qa_router

for mod in [auth, admin, admin_classes, admin_grades, cases, export, feedback, notes, questionnaires, stats]:
    app.include_router(mod.router)
app.include_router(admin_api_router)
app.include_router(admin_prompts_router)
app.include_router(admin_scenarios_router)
app.include_router(admin_plugins_router)
app.include_router(admin_schools_router)
app.include_router(admin_roles_router)
app.include_router(training_router)
app.include_router(chat_router)
app.include_router(nursing_router)
app.include_router(qa_router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": APP_VERSION}
