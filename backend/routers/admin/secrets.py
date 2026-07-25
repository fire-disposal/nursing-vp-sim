"""API 档案 + 用途指派 CRUD — thin router."""

import time
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, Query, Request

from core.deps import DbSession
from core.security import require_permission
from infrastructure.llm import decrypt_api_key, get_env_fallback_state
from models import ApiSecret, LLMConfig, User
from schemas import (
    ApiSecretCreate,
    ApiSecretResponse,
    ApiSecretUpdate,
    ConfigCreateResponse,
    DeleteResponse,
    FallbackStateResponse,
    HealthCheckItem,
    LLMConfigCreate,
    LLMConfigResponse,
    LLMConfigUpdate,
    OkResponse,
    SecretCreateResponse,
    TestAllResultsResponse,
    TestResultItem,
    ToggleStatusResponse,
)
from services.api_secret import ApiSecretService
from services.llm_config import LLMConfigService

router = APIRouter(prefix="", tags=["API管理"])

_Manager = Annotated[User, Depends(require_permission("api_manage"))]


def _secret_resp(s: dict) -> ApiSecretResponse:
    return ApiSecretResponse(**s)


# ── ApiSecret CRUD ──


@router.get("/secrets", response_model=list[ApiSecretResponse])
def list_secrets(current_user: _Manager, db: DbSession):
    return [_secret_resp(s) for s in ApiSecretService(db).list_with_config_counts()]


@router.post("/secrets", status_code=201, response_model=SecretCreateResponse)
def create_secret(data: ApiSecretCreate, current_user: _Manager, db: DbSession):
    return ApiSecretService(db).create(data.model_dump())


@router.put("/secrets/{secret_id}", response_model=OkResponse)
def update_secret(secret_id: int, data: ApiSecretUpdate, current_user: _Manager, db: DbSession):
    ApiSecretService(db).update(secret_id, data.model_dump(exclude_unset=True))
    return {"ok": True}


@router.delete("/secrets/{secret_id}", response_model=DeleteResponse)
async def delete_secret(secret_id: int, request: Request, current_user: _Manager, db: DbSession):
    ApiSecretService(db).delete(secret_id)
    await request.app.state.llm_router.load_from_db()
    return {"ok": True}


# ── LLMConfig CRUD ──


@router.get("/configs", response_model=list[LLMConfigResponse])
def list_configs(
    current_user: Annotated[User, Depends(require_permission("api_manage"))],
    db: DbSession,
    purpose: Annotated[str | None, Query()] = None,
):
    return [LLMConfigResponse(**c) for c in LLMConfigService(db).list_all(purpose)]


@router.post("/configs", status_code=201, response_model=ConfigCreateResponse)
async def create_config(data: LLMConfigCreate, request: Request, current_user: _Manager, db: DbSession):
    cfg_id = LLMConfigService(db).create_or_reactivate(
        secret_id=data.secret_id,
        purpose=data.purpose,
        label=data.label or "",
        model_override=data.model_override,
    )
    await request.app.state.llm_router.load_from_db()
    return {"id": cfg_id}


@router.put("/configs/{config_id}", response_model=OkResponse)
async def update_config(config_id: int, data: LLMConfigUpdate, request: Request, current_user: _Manager, db: DbSession):
    LLMConfigService(db).update(config_id, data.model_dump(exclude_unset=True))
    await request.app.state.llm_router.load_from_db()
    return {"ok": True}


@router.delete("/configs/{config_id}", response_model=DeleteResponse)
async def delete_config(config_id: int, request: Request, current_user: _Manager, db: DbSession):
    LLMConfigService(db).delete(config_id)
    await request.app.state.llm_router.load_from_db()
    return {"ok": True}


@router.post("/configs/{config_id}/toggle", response_model=ToggleStatusResponse)
async def toggle_config(config_id: int, request: Request, current_user: _Manager, db: DbSession):
    status = LLMConfigService(db).toggle(config_id)
    await request.app.state.llm_router.load_from_db()
    return {"ok": True, "status": status}


@router.post("/configs/{config_id}/reset", response_model=OkResponse)
async def reset_profile(config_id: int, request: Request, current_user: _Manager, db: DbSession):
    LLMConfigService(db).reset(config_id)
    await request.app.state.llm_router.load_from_db()
    return {"ok": True}


async def _test_secret(secret, client: httpx.AsyncClient, timeout: float = 10) -> dict:
    api_key = decrypt_api_key(secret.encrypted_key)
    base_url = secret.base_url or ""
    try:
        t0 = time.monotonic()
        resp = await client.get(f"{base_url}/v1/models", headers={"Authorization": f"Bearer {api_key}"})
        latency = int((time.monotonic() - t0) * 1000)
        return {
            "base_url": base_url,
            "ok": resp.status_code < 500,
            "status_code": resp.status_code,
            "latency_ms": latency,
        }
    except Exception as e:
        return {"base_url": base_url, "ok": False, "error": str(e)[:200]}


@router.post("/configs/{config_id}/test", response_model=TestResultItem)
async def test_config(config_id: int, current_user: _Manager, db: DbSession):
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        from core.exceptions import NotFoundError

        raise NotFoundError("指派不存在")
    secret = db.query(ApiSecret).filter(ApiSecret.id == cfg.secret_id).first()
    if not secret:
        from core.exceptions import NotFoundError

        raise NotFoundError("密钥不存在")
    async with httpx.AsyncClient(timeout=httpx.Timeout(10)) as client:
        return await _test_secret(secret, client)


@router.post("/configs/test-all", response_model=TestAllResultsResponse)
async def test_all_configs(current_user: _Manager, db: DbSession):
    secrets = db.query(ApiSecret).all()
    async with httpx.AsyncClient(timeout=httpx.Timeout(8)) as client:
        results = [await _test_secret(s, client) for s in secrets]
    return {"results": results}


@router.get("/health", response_model=list[HealthCheckItem])
async def health_check(current_user: _Manager, db: DbSession):
    secrets = db.query(ApiSecret).all()
    async with httpx.AsyncClient(timeout=httpx.Timeout(5)) as client:
        results = []
        for s in secrets:
            r = await _test_secret(s, client, timeout=5)
            results.append(
                {
                    "base_url": r["base_url"],
                    "status": "ok" if r.get("ok") else "error",
                    "latency_ms": r.get("latency_ms"),
                    "error": r.get("error"),
                }
            )
    return results


# ── Env Fallback ──


@router.get("/fallback", response_model=FallbackStateResponse)
async def get_env_fallback(current_user: _Manager):
    return await get_env_fallback_state()


@router.post("/fallback/test", response_model=TestResultItem)
async def test_env_fallback(current_user: _Manager):
    from core.config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL

    if not DEEPSEEK_API_KEY:
        return {"base_url": DEEPSEEK_BASE_URL, "ok": False, "error": "DEEPSEEK_API_KEY 未设置"}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10)) as client:
            t0 = time.monotonic()
            resp = await client.get(
                f"{DEEPSEEK_BASE_URL}/v1/models", headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}"}
            )
            return {
                "base_url": DEEPSEEK_BASE_URL,
                "ok": resp.status_code < 400,
                "status_code": resp.status_code,
                "latency_ms": int((time.monotonic() - t0) * 1000),
            }
    except Exception as e:
        return {"base_url": DEEPSEEK_BASE_URL, "ok": False, "error": str(e)[:200]}


# ── Router Reload ──


@router.post("/reload", response_model=OkResponse)
async def reload_router(request: Request, current_user: _Manager):
    await request.app.state.llm_router.load_from_db()
    return {"ok": True}
