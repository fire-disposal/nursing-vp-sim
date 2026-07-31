"""Application bootstrap — startup/shutdown orchestration and runtime infrastructure wiring.

This is infrastructure code: queues, metrics, realtime hub, LLM/TTS clients, and background
publishers. Business decisions stay in ``modules``.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from contextlib import suppress
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import insert, text

from core.config import (
    CLEANUP_INTERVAL_SECONDS,
    DEEPSEEK_API_KEY,
    LLM_LOG_OVERFLOW_DIR,
    LLM_LOG_OVERFLOW_MAX_FILES,
    LLM_LOG_OVERFLOW_MAX_SIZE_MB,
)
from core.database import SessionLocal, engine
from infra.diagnose import get_diagnose_service
from infra.llm import LogWorker, ProfileRouter
from infra.llm.client import LLMClient
from infra.metrics import MetricsSnapshot
from infra.queue import TaskQueue
from infra.realtime import RealtimeHub
from infra.scoring_progress import ScoringProgressTracker
from models import Notification, SystemNotification, User
from modules.training.session.cache import EmotionCache, InitiativeCache
from modules.training.session.settlement import settlement_loop

if TYPE_CHECKING:
    import httpx

log = logging.getLogger(__name__)

NOTIFICATION_LOCK_KEY = 987654322

_infra_client: httpx.AsyncClient | None = None
_infra_router: ProfileRouter | None = None
_infra_log_worker: LogWorker | None = None
_main_loop: asyncio.AbstractEventLoop | None = None
_background_thread: threading.Thread | None = None
_loop_lock = threading.Lock()


async def startup(app):
    """Initialize all subsystems in dependency order."""
    app_state = app.state
    app_state.app = app

    metrics = await init_infra(app_state, app_state.llm_router)
    await init_llm(app_state, app_state.httpx_client, app_state.llm_router, metrics)
    init_tts(app_state)

    if hasattr(app_state, "log_worker") and app_state.log_worker is not None:
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
    if hasattr(app_state, "log_worker") and app_state.log_worker:
        await app_state.log_worker.stop()
    if hasattr(app_state, "realtime_hub") and app_state.realtime_hub:
        app_state.realtime_hub.stop()

    tts_pool = getattr(app_state, "tts_pool", None)
    if tts_pool is not None:
        await tts_pool.aclose()
    if app_state.httpx_client:
        await app_state.httpx_client.aclose()

    await asyncio.to_thread(engine.dispose)
    await asyncio.to_thread(stop_background_loop)


async def init_infra(app_state, llm_router):
    """Initialize task queue, runtime caches, metrics, diagnose, and realtime hub."""
    task_queue = TaskQueue()
    await task_queue.start()
    app_state.task_queue = task_queue
    log.info("Task queue: %d workers", task_queue.max_workers)

    app_state.emotion_cache = EmotionCache()
    app_state.initiative_cache = InitiativeCache()
    app_state.scoring_tracker = ScoringProgressTracker()
    from infra.telemetry import FrontendErrorBuffer

    app_state.frontend_error_buffer = FrontendErrorBuffer()

    loop = asyncio.get_running_loop()
    hub = RealtimeHub()
    hub.start(loop)
    app_state.realtime_hub = hub
    log.info("RealtimeHub: PG LISTEN/NOTIFY listener started")

    metrics = MetricsSnapshot()
    app_state.metrics = metrics
    metrics.task_queue_size_supplier = lambda: task_queue.pending if task_queue else 0
    metrics.log_queue_size_supplier = lambda: (
        app_state.log_worker._queue.qsize() if app_state.log_worker and app_state.log_worker._queue else 0
    )
    metrics.degraded_providers_supplier = lambda: llm_router.degraded_count() if llm_router else 0
    metrics.global_degraded_supplier = lambda: llm_router.global_degraded if llm_router else False

    diagnose_svc = get_diagnose_service()
    diagnose_svc.install_handler()
    diagnose_svc.set_app(app_state.app)

    return metrics


async def init_llm(app_state, httpx_client, llm_router, metrics):
    """Initialize LLM router state, log worker, and client."""
    if llm_router is None:
        log.warning("LLM router 不可用，跳过 LLM 基础设施初始化")
        return
    try:
        await llm_router.load_from_db()
    except Exception:
        log.exception("LLM router 加载失败，跳过 LLM 基础设施初始化")
        app_state.llm_router = None
        return

    if DEEPSEEK_API_KEY and DEEPSEEK_API_KEY.startswith("sk-"):
        log.info("Env fallback: available")

    log_worker = LogWorker(
        overflow_dir=LLM_LOG_OVERFLOW_DIR,
        overflow_max_size_mb=LLM_LOG_OVERFLOW_MAX_SIZE_MB,
        overflow_max_files=LLM_LOG_OVERFLOW_MAX_FILES,
    )
    await log_worker.start()
    app_state.log_worker = log_worker

    app_state.llm_client = LLMClient(
        http=httpx_client,
        router=llm_router,
        log_worker=log_worker,
        metrics=metrics,
    )


def init_tts(app_state):
    """Load TTS state into app. Non-fatal on failure."""
    try:
        from modules.voice.service import load_tts_state

        db_voice = SessionLocal()
        try:
            load_tts_state(app_state, db_voice)
        finally:
            db_voice.close()
    except Exception:
        app_state.tts_client = None
        app_state.tts_pool = None
        app_state.tts_config = {}
        log.exception("TTS client init failed (non-fatal)")


def start_background_loop(app_state, httpx_client, llm_router, log_worker):
    """Start a dedicated event loop thread for cross-thread background work."""
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=False, name="bg-loop")
    thread.start()
    app_state._background_loop = loop
    app_state._background_thread = thread
    set_training_infra(httpx_client, llm_router, log_worker, loop)
    return loop


async def start_settlement(app_state, cleanup_interval):
    """Start settlement loop and notification publisher as background tasks."""
    settlement_task = asyncio.create_task(settlement_loop(interval=cleanup_interval, app_state=app_state))
    app_state._settlement_task = settlement_task
    log.info("Settlement: started (interval=%ds)", cleanup_interval)

    notif_task = asyncio.create_task(notification_publisher(interval=60))
    app_state._notification_task = notif_task
    log.info("Notification publisher: started (interval=60s)")


async def shutdown_background(app_state):
    """Cancel settlement and notification tasks."""
    for attr in ("_settlement_task", "_notification_task"):
        task = getattr(app_state, attr, None)
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


def publish_pending_notifications() -> None:
    """Deliver due system notifications to active users.

    Holds a PostgreSQL advisory lock so only one worker publishes at a time.
    Safe to call repeatedly; failures are logged and swallowed.
    """
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
                log.warning("Notification publisher: %d pending but no active users; deferring", len(pending))
                return
            for system_notification in pending:
                db.execute(
                    insert(Notification).values(
                        [
                            dict(
                                user_id=user_id,
                                type="system",
                                title=system_notification.title,
                                body=system_notification.content,
                            )
                            for user_id in user_ids
                        ]
                    )
                )
                system_notification.is_active = False
                log.info("Notification published: %s -> %d users", system_notification.title, len(user_ids))
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


async def notification_publisher(interval: int = 60):
    """Periodically publish due SystemNotification rows."""
    while True:
        await asyncio.sleep(interval)
        await asyncio.to_thread(publish_pending_notifications)


def set_training_infra(client, router_obj, log_worker, background_loop=None):
    global _infra_client, _infra_router, _infra_log_worker, _main_loop
    _infra_client = client
    _infra_router = router_obj
    _infra_log_worker = log_worker
    if background_loop is not None:
        _main_loop = background_loop


def stop_background_loop():
    global _main_loop, _background_thread
    if _main_loop is not None and not _main_loop.is_closed():
        _main_loop.call_soon_threadsafe(_main_loop.stop)
    if _background_thread is not None and _background_thread.is_alive():
        _background_thread.join(timeout=10)
    _main_loop = None
    _background_thread = None


def _get_client():
    if _infra_client is None:
        raise RuntimeError("Training infra not initialized")
    return _infra_client


def _get_router():
    if _infra_router is None:
        raise RuntimeError("Training infra not initialized")
    return _infra_router


def _get_log_worker():
    if _infra_log_worker is None:
        raise RuntimeError("Training infra not initialized")
    return _infra_log_worker


def _schedule_background(coro):
    try:
        loop = asyncio.get_running_loop()
        return loop.create_task(coro)
    except RuntimeError:
        loop = _ensure_loop()
        return asyncio.run_coroutine_threadsafe(coro, loop)


def _ensure_loop():
    global _main_loop, _background_thread
    with _loop_lock:
        if _main_loop is None or _main_loop.is_closed():
            _main_loop = asyncio.new_event_loop()
            _background_thread = threading.Thread(target=_main_loop.run_forever, daemon=False)
            _background_thread.start()
    return _main_loop


def _handle_task_exception(loop, context):
    """Log unhandled task exceptions without crashing the event loop."""
    msg = context.get("message", "Unhandled task exception")
    exc = context.get("exception")
    if exc:
        log.exception("%s: %s", msg, exc)
    else:
        log.error("%s: %s", msg, context)
