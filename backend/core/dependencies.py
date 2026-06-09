"""FastAPI dependency injection factories.

All infrastructure objects live on app.state and are injected
via Depends. No module-level global variables.
"""

from typing import Annotated

import httpx
from fastapi import Depends, Request

from infrastructure.cache import EmotionCache, InitiativeCache
from infrastructure.llm.client import LLMClient
from infrastructure.queue import TaskQueue
from middleware.rate_limits import RateLimiter
from infrastructure.llm import LogWorker, ProfileRouter
from infrastructure.prompt import PromptManager


# ── Infrastructure ──

def get_httpx_client(request: Request) -> httpx.AsyncClient:
    return request.app.state.httpx_client


def get_llm_router(request: Request) -> ProfileRouter:
    return request.app.state.llm_router


def get_log_worker(request: Request) -> LogWorker:
    return request.app.state.log_worker


def get_prompt_manager(request: Request) -> PromptManager:
    return request.app.state.prompt_manager


def get_rate_limiter(request: Request) -> RateLimiter:
    return request.app.state.rate_limiter


def get_llm_client(request: Request) -> LLMClient:
    return request.app.state.llm_client


def get_task_queue(request: Request) -> TaskQueue:
    return request.app.state.task_queue


def get_emotion_cache(request: Request) -> EmotionCache:
    return request.app.state.emotion_cache


def get_initiative_cache(request: Request) -> InitiativeCache:
    return request.app.state.initiative_cache


# ── School filter ──

def resolve_school_filter(source_user, school_id_param: int | None = None) -> int | None:
    if source_user is None:
        return school_id_param
    return source_user.school_id


# ── Type aliases ──

HttpxClientDep = Annotated[httpx.AsyncClient, Depends(get_httpx_client)]
LLMRouterDep = Annotated[ProfileRouter, Depends(get_llm_router)]
PromptManagerDep = Annotated[PromptManager, Depends(get_prompt_manager)]
LLMClientDep = Annotated[LLMClient, Depends(get_llm_client)]
TaskQueueDep = Annotated[TaskQueue, Depends(get_task_queue)]
EmotionCacheDep = Annotated[EmotionCache, Depends(get_emotion_cache)]
InitiativeCacheDep = Annotated[InitiativeCache, Depends(get_initiative_cache)]
