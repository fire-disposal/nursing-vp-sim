"""LLM infrastructure bootstrap — router warm-up, env fallback, log worker, LLM client."""

import logging

from core.config import DEEPSEEK_API_KEY, LLM_LOG_OVERFLOW_DIR, LLM_LOG_OVERFLOW_MAX_FILES, LLM_LOG_OVERFLOW_MAX_SIZE_MB
from infrastructure.llm import LogWorker
from infrastructure.llm.client import LLMClient

log = logging.getLogger(__name__)


async def init_llm(app_state, httpx_client, llm_router, metrics):
    """Initialize LLM infrastructure: warm-up router, start log worker, create client."""
    await llm_router.load_from_db()
    log.info("Profile router: ready")

    if DEEPSEEK_API_KEY and DEEPSEEK_API_KEY.startswith("sk-"):
        import infrastructure.llm.router as llm_router_mod

        llm_router_mod._env_fallback_available = True
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
