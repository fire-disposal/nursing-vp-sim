"""Settlement and background loop bootstrap."""

import asyncio
import logging
import threading

from contexts.training.router.session import set_training_infra
from contexts.training.settlement import settlement_loop
from repositories.training import TrainingRepository

log = logging.getLogger(__name__)


def start_background_loop(app_state, httpx_client, llm_router, log_worker):
    """Start a dedicated event loop thread for background tasks."""
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=False, name="bg-loop")
    thread.start()
    app_state._background_loop = loop
    app_state._background_thread = thread
    set_training_infra(httpx_client, llm_router, log_worker, loop)
    return loop


async def start_settlement(app_state, cleanup_interval):
    """Start settlement loop and notification publisher as background tasks."""

    async def _enqueue_settlement_scoring(record_id: int, case_data: dict) -> None:
        from contexts.training.router.scoring import _run_scoring_background

        await app_state.task_queue.enqueue(
            lambda rid=record_id, cd=case_data: _run_scoring_background(
                rid,
                cd,
                llm_client=app_state.llm_client,
                realtime_hub=app_state.realtime_hub,
            ),
            priority=6,
        )

    settlement_task = asyncio.create_task(
        settlement_loop(
            repo=TrainingRepository(),
            interval=cleanup_interval,
            enqueue_scoring=_enqueue_settlement_scoring,
        )
    )
    app_state._settlement_task = settlement_task
    log.info("Settlement: started (interval=%ds)", cleanup_interval)

    from main import _notification_publisher

    notif_task = asyncio.create_task(_notification_publisher(interval=60))
    app_state._notification_task = notif_task
    log.info("Notification publisher: started (interval=60s)")


async def shutdown_background(app_state):
    """Cancel settlement and notification tasks."""
    import asyncio
    from contextlib import suppress

    for attr in ("_settlement_task", "_notification_task"):
        task = getattr(app_state, attr, None)
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
