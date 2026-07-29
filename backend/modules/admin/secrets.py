"""API 档案 CRUD — router + service."""

from __future__ import annotations

import logging
import re
import time
from typing import TYPE_CHECKING, Annotated

import httpx
from fastapi import APIRouter, Depends, Request

if TYPE_CHECKING:
    from sqlalchemy.orm import Session



from core.deps import DbSession
from core.exceptions import ConflictError, NotFoundError, ValidationError
from core.security import require_permission
from core.unit_of_work import unit_of_work
from infra.llm import get_env_fallback_state
from models import ApiSecret, LLMCallLog, User
from repositories.api_secret import ApiSecretRepository
from schemas import (
    ApiSecretCreate,
    ApiSecretResponse,
    ApiSecretUpdate,
    DeleteResponse,
    FallbackStateResponse,
    HealthCheckItem,
    OkResponse,
    SecretCreateResponse,
    TestAllResultsResponse,
    TestResultItem,
)

log = logging.getLogger(__name__)


class ApiSecretService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = ApiSecretRepository(db)

    def list_all(self) -> list[ApiSecret]:
        return self.repo.list_all(order_by=ApiSecret.created_at.desc())

    def list_for_admin(self) -> list[dict]:
        secrets = self.repo.list_all(order_by=ApiSecret.created_at.desc())
        result = []
        for s in secrets:
            result.append(
                {
                    "id": s.id,
                    "label": s.label,
                    "key_suffix": s.api_key[-4:] if s.api_key and len(s.api_key) >= 4 else "****",
                    "base_url": s.base_url or "",
                    "status": s.status,
                    "degraded_reason": s.degraded_reason,
                    "degraded_until": s.degraded_until,
                    "price_input_per_1m": float(s.price_input_per_1m),
                    "price_output_per_1m": float(s.price_output_per_1m),
                    "monthly_cost_limit": float(s.monthly_cost_limit) if s.monthly_cost_limit else None,
                    "call_count_today": s.call_count_today or 0,
                    "total_tokens_today": s.total_tokens_today or 0,
                    "total_cost_today": float(s.total_cost_today or 0),
                    "monthly_cost_used": float(s.monthly_cost_used or 0),
                    "priority": s.priority or 0,
                    "model_override": s.model_override,
                    "last_used_at": s.last_used_at,
                    "created_at": s.created_at,
                    "updated_at": s.updated_at,
                }
            )
        return result

    def create(self, data: dict) -> dict:
        if data.get("base_url") and not re.match(r"^https?://", data["base_url"]):
            raise ValidationError("base_url 必须以 http:// 或 https:// 开头")

        raw_key = data.get("raw_key", "")
        for existing in self.repo.list_all():
            if existing.api_key == raw_key:
                raise ConflictError("该 API Key 已存在，请勿重复添加")

        with unit_of_work(self.db, conflict_detail="创建密钥失败"):
            s = self.repo.add(
                ApiSecret(
                    label=data["label"],
                    api_key=raw_key,
                    base_url=data.get("base_url", ""),
                    price_input_per_1m=data.get("price_input_per_1m", 0),
                    price_output_per_1m=data.get("price_output_per_1m", 0),
                    monthly_cost_limit=data.get("monthly_cost_limit"),
                    priority=data.get("priority", 0),
                    model_override=data.get("model_override"),
                )
            )
        self.db.refresh(s)
        return {"id": s.id, "key_suffix": s.api_key[-4:] if s.api_key and len(s.api_key) >= 4 else "****"}

    def update(self, secret_id: int, data: dict) -> None:
        s = self.repo.get(secret_id)
        if not s:
            raise ValidationError("密钥不存在")
        with unit_of_work(self.db, conflict_detail="更新密钥失败"):
            editable = (
                "label",
                "base_url",
                "price_input_per_1m",
                "price_output_per_1m",
                "monthly_cost_limit",
                "priority",
                "model_override",
            )
            for field in editable:
                val = data.get(field)
                if val is not None:
                    setattr(s, field, val)

    def delete(self, secret_id: int) -> None:
        s = self.repo.get(secret_id)
        if not s:
            raise ValidationError("密钥不存在")

        with unit_of_work(self.db, conflict_detail="删除密钥失败"):
            self.db.query(LLMCallLog).filter(LLMCallLog.secret_id == secret_id).update(
                {LLMCallLog.secret_id: None}, synchronize_session=False
            )
            self.repo.delete(s)


router = APIRouter(prefix="", tags=["API管理"])

_Manager = Annotated[User, Depends(require_permission("api_manage"))]


def _secret_resp(s: dict) -> ApiSecretResponse:
    return ApiSecretResponse(**s)


# ── ApiSecret CRUD ──


@router.get("/secrets", response_model=list[ApiSecretResponse])
def list_secrets(current_user: _Manager, db: DbSession):
    return [_secret_resp(s) for s in ApiSecretService(db).list_for_admin()]


@router.post("/secrets", status_code=201, response_model=SecretCreateResponse)
def create_secret(data: ApiSecretCreate, current_user: _Manager, db: DbSession):
    return ApiSecretService(db).create(data.model_dump())


@router.put("/secrets/{secret_id}", response_model=OkResponse)
async def update_secret(
    secret_id: int,
    data: ApiSecretUpdate,
    request: Request,
    current_user: _Manager,
    db: DbSession,
):
    ApiSecretService(db).update(secret_id, data.model_dump(exclude_unset=True))
    await request.app.state.llm_router.load_from_db()
    return {"ok": True}


@router.delete("/secrets/{secret_id}", response_model=DeleteResponse)
async def delete_secret(
    secret_id: int,
    request: Request,
    current_user: _Manager,
    db: DbSession,
):
    ApiSecretService(db).delete(secret_id)
    await request.app.state.llm_router.load_from_db()
    return {"ok": True}


# ── Secret Testing ──


async def _test_secret(
    secret, client: httpx.AsyncClient, timeout: float = 10
) -> dict:
    api_key = secret.api_key
    base_url = secret.base_url or ""
    try:
        t0 = time.monotonic()
        resp = await client.get(
            f"{base_url}/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        latency = int((time.monotonic() - t0) * 1000)
        return {
            "base_url": base_url,
            "ok": resp.status_code < 500,
            "status_code": resp.status_code,
            "latency_ms": latency,
        }
    except Exception as e:
        return {"base_url": base_url, "ok": False, "error": str(e)[:200]}


@router.post("/secrets/{secret_id}/test", response_model=TestResultItem)
async def test_secret_endpoint(
    secret_id: int, current_user: _Manager, db: DbSession
):
    secret = db.query(ApiSecret).filter(ApiSecret.id == secret_id).first()
    if not secret:
        raise NotFoundError("密钥不存在")
    async with httpx.AsyncClient(timeout=httpx.Timeout(10)) as client:
        return await _test_secret(secret, client)


@router.post("/secrets/test-all", response_model=TestAllResultsResponse)
async def test_all_secrets(current_user: _Manager, db: DbSession):
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
        return {
            "base_url": DEEPSEEK_BASE_URL,
            "ok": False,
            "error": "DEEPSEEK_API_KEY 未设置",
        }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10)) as client:
            t0 = time.monotonic()
            resp = await client.get(
                f"{DEEPSEEK_BASE_URL}/v1/models",
                headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}"},
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
