"""Shared LLM infrastructure — module-level references to app-state objects.

Set during app startup via set_infra(). Used by both request handlers (via
app.state) and background tasks (via these module-level refs). Background
tasks import these instead of creating duplicate infrastructure instances.
"""

import asyncio

import httpx

from services.llm.logging import LogWorker
from services.llm.router import ProfileRouter
from services.prompt.manager import PromptManager

_client: httpx.AsyncClient | None = None
_router: ProfileRouter | None = None
_pm: PromptManager | None = None
_log_worker: LogWorker | None = None
_main_loop: asyncio.AbstractEventLoop | None = None


def set_infra(
    client: httpx.AsyncClient,
    router: ProfileRouter,
    pm: PromptManager,
    log_worker: LogWorker,
) -> None:
    global _client, _router, _pm, _log_worker, _main_loop
    _client = client
    _router = router
    _pm = pm
    _log_worker = log_worker
    _main_loop = asyncio.get_running_loop()


def get_client() -> httpx.AsyncClient:
    assert _client is not None, "LLM infra not initialized"
    return _client


def get_router() -> ProfileRouter:
    assert _router is not None, "LLM infra not initialized"
    return _router


def get_pm() -> PromptManager:
    assert _pm is not None, "LLM infra not initialized"
    return _pm


def get_log_worker() -> LogWorker:
    assert _log_worker is not None, "LLM infra not initialized"
    return _log_worker


def get_main_loop() -> asyncio.AbstractEventLoop:
    assert _main_loop is not None, "LLM infra not initialized"
    return _main_loop


def schedule_background(coro):
    """Schedule a coroutine on the main loop, works from any thread."""
    loop = get_main_loop()
    try:
        current = asyncio.get_running_loop()
        if current is loop:
            return asyncio.create_task(coro)
    except RuntimeError:
        pass
    return asyncio.run_coroutine_threadsafe(coro, loop)
