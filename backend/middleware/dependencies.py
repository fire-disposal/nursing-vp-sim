import logging
from typing import Annotated

import httpx
from fastapi import Depends, Request

from middleware.rate_limits import RateLimiter

log = logging.getLogger(__name__)


def resolve_school_filter(source_user, school_id_param: int | None = None) -> int | None:
    """返回数据隔离的 school_id。
    普通用户：返回自己学校，忽略参数。
    super_admin：返回参数值（若提供），None 表示全局不过滤。
    """
    if source_user is None:
        return school_id_param
    if source_user.school_id is not None:
        return source_user.school_id
    return school_id_param


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
