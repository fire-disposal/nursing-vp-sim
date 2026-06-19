import logging
from typing import Annotated

import httpx
from fastapi import Depends, Request

from middleware.rate_limits import PgRateLimiter

log = logging.getLogger(__name__)


def resolve_school_filter(source_user, school_id_param: int | None = None) -> int | None:
    if source_user is None:
        return school_id_param
    return source_user.school_id


def get_rate_limiter(request: Request) -> PgRateLimiter:
    return request.app.state.rate_limiter


def get_prompt_manager(request: Request):
    return request.app.state.prompt_manager


def get_llm_router(request: Request):
    return request.app.state.llm_router


def get_httpx_client(request: Request) -> httpx.AsyncClient:
    return request.app.state.httpx_client


def get_log_worker(request: Request):
    return request.app.state.log_worker


from infrastructure.llm import ProfileRouter
from infrastructure.prompt import PromptManager

PromptManagerDep = Annotated[PromptManager, Depends(get_prompt_manager)]
LLMRouterDep = Annotated[ProfileRouter, Depends(get_llm_router)]
HttpxClientDep = Annotated[httpx.AsyncClient, Depends(get_httpx_client)]
