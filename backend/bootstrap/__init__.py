"""Application bootstrap — startup and shutdown orchestration."""

import asyncio
import logging

from bootstrap.infra import init_infra
from bootstrap.llm import init_llm
from bootstrap.settlement import shutdown_background, start_background_loop, start_settlement
from bootstrap.voice import init_tts
from bootstrap._infra import stop_background_loop
from core.config import CLEANUP_INTERVAL_SECONDS
from core.database import engine

log = logging.getLogger(__name__)


async def startup(app):
    """Initialize all subsystems in dependency order."""
    app_state = app.state
    app_state.app = app

    # Phase 1: LLM infrastructure (router warm-up, log worker, client)
    await init_llm(app_state, app_state.httpx_client, app_state.llm_router, app_state.metrics)

    # Phase 2: General infrastructure (queue, caches, metrics, diagnose)
    metrics = await init_infra(app_state, app_state.llm_router)

    # Phase 3: LLM client (needs metrics from phase 2)
    # (init_llm already created the client — re-assign metrics reference)
    app_state.llm_client.metrics = metrics

    # Phase 4: TTS
    init_tts(app_state)

    # Phase 5: Background loop + settlement
    start_background_loop(app_state, app_state.httpx_client, app_state.llm_router, app_state.log_worker)
    await start_settlement(app_state, CLEANUP_INTERVAL_SECONDS)

    loop = asyncio.get_running_loop()
    loop.set_exception_handler(_handle_task_exception)

    log.info("──────────────────────────────────────────────")
    log.info("Fiat Lux Machinae.")
    log.info("让机械之光成就")
    log.info("──────────────────────────────────────────────")
    log.info("Ready")


async def shutdown(app):
    """Gracefully tear down all subsystems."""
    app_state = app.state

    await shutdown_background(app_state)
    await app_state.task_queue.stop()
    await app_state.log_worker.stop()

    tts_pool = getattr(app_state, "tts_pool", None)
    if tts_pool is not None:
        await tts_pool.aclose()
    if app_state.httpx_client:
        await app_state.httpx_client.aclose()

    await asyncio.to_thread(engine.dispose)
    await asyncio.to_thread(stop_background_loop)


def _handle_task_exception(loop, context):
    """Log unhandled task exceptions without crashing the event loop."""
    msg = context.get("message", "Unhandled task exception")
    exc = context.get("exception")
    if exc:
        log.exception("%s: %s", msg, exc)
    else:
        log.error("%s: %s", msg, context)
