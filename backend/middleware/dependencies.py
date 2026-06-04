import logging
from typing import Annotated

import httpx
from fastapi import Depends, Request

from middleware.rate_limits import RateLimiter

log = logging.getLogger(__name__)


def get_rate_limiter(request: Request) -> RateLimiter:
    return request.app.state.rate_limiter


def get_prompt_manager(request: Request):
    return request.app.state.prompt_manager


def get_llm_router(request: Request):
    return request.app.state.llm_router


def get_httpx_client(request: Request) -> httpx.AsyncClient:
    return request.app.state.httpx_client


def get_log_worker(request: Request):
    return request.app.state.log_worker


PromptManagerDep = Annotated[object, Depends(get_prompt_manager)]
LLMRouterDep = Annotated[object, Depends(get_llm_router)]
HttpxClientDep = Annotated[httpx.AsyncClient, Depends(get_httpx_client)]
