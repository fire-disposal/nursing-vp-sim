"""General infrastructure bootstrap — task queue, caches, metrics, diagnose, realtime hub."""

import logging

from contexts.training.session_cache import EmotionCache, InitiativeCache
from infrastructure.diagnose import get_diagnose_service
from infrastructure.metrics import MetricsSnapshot
from infrastructure.queue import TaskQueue
from infrastructure.realtime_hub import RealtimeHub
from infrastructure.scoring_progress import ScoringProgressTracker

log = logging.getLogger(__name__)


async def init_infra(app_state, llm_router):
    """Initialize task queue, caches, metrics, diagnose, and realtime hub."""
    task_queue = TaskQueue()
    await task_queue.start()
    app_state.task_queue = task_queue
    log.info("Task queue: %d workers", task_queue.max_workers)

    app_state.emotion_cache = EmotionCache()
    app_state.initiative_cache = InitiativeCache()
    app_state.scoring_tracker = ScoringProgressTracker()
    app_state.realtime_hub = RealtimeHub()

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
