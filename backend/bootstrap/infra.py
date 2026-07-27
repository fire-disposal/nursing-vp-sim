"""Infrastructure bootstrap — task queue, caches, metrics, diagnose, realtime hub, and training globals."""

import asyncio
import logging
import threading

import httpx

from contexts.training.session.cache import EmotionCache, InitiativeCache
from infrastructure.diagnose import get_diagnose_service
from infrastructure.llm import LogWorker, ProfileRouter
from infrastructure.metrics import MetricsSnapshot
from infrastructure.queue import TaskQueue
from infrastructure.realtime_hub import RealtimeHub
from infrastructure.scoring_progress import ScoringProgressTracker

log = logging.getLogger(__name__)

# Module-level shared state — initialized by bootstrap


async def init_infra(app_state, llm_router):
    """Initialize task queue, caches, metrics, diagnose, and realtime hub."""
    task_queue = TaskQueue()
    await task_queue.start()
    app_state.task_queue = task_queue
    log.info("Task queue: %d workers", task_queue.max_workers)

    app_state.emotion_cache = EmotionCache()
    app_state.initiative_cache = InitiativeCache()
    app_state.scoring_tracker = ScoringProgressTracker()
    from infrastructure.frontend_telemetry import FrontendErrorBuffer

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


_infra_client: httpx.AsyncClient | None = None
_infra_router: ProfileRouter | None = None
_infra_log_worker: LogWorker | None = None
_main_loop: asyncio.AbstractEventLoop | None = None
_background_thread: threading.Thread | None = None
_loop_lock = threading.Lock()


def _ensure_loop():
    global _main_loop, _background_thread
    with _loop_lock:
        if _main_loop is None or _main_loop.is_closed():
            _main_loop = asyncio.new_event_loop()
            _background_thread = threading.Thread(target=_main_loop.run_forever, daemon=False)
            _background_thread.start()
    return _main_loop


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
