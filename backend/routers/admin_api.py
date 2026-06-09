"""API 档案 + 用途指派 CRUD"""

import logging
import time
from typing import Annotated

log = logging.getLogger(__name__)

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import require_permission
from models import ApiSecret, LLMConfig, Rubric, User
from schemas import (
    ApiSecretCreate,
    ApiSecretResponse,
    ApiSecretUpdate,
    CatalogResponse,
    ConfigCreateResponse,
    HealthCheckItem,
    LLMConfigCreate,
    LLMConfigResponse,
    LLMConfigUpdate,
    ModelPresetItem,
    OkResponse,
    ProviderPresetResponse,
    RubricResponse,
    SecretCreateResponse,
    TestAllResultsResponse,
    TestResultItem,
    ToggleStatusResponse,
)
from services.llm import decrypt_api_key, encrypt_api_key, get_env_fallback_state
from services.llm import get_catalog, infer_provider_name

router = APIRouter(prefix="/api/admin/api", tags=["API管理"])


# ── ApiSecret (API 档案) CRUD ──


@router.get("/secrets", response_model=list[ApiSecretResponse])
def list_secrets(current_user: Annotated[User, Depends(require_permission("api_manage"))], db: Annotated[Session, Depends(get_db)]):
    secrets = db.query(ApiSecret).order_by(ApiSecret.created_at.desc()).all()
    result = []
    for s in secrets:
        config_count = db.query(LLMConfig).filter(LLMConfig.secret_id == s.id).count()
        result.append(
            ApiSecretResponse(
                id=s.id,
                label=s.label,
                key_suffix=s.key_suffix,
                base_url=s.base_url or "",
                provider=infer_provider_name(s.base_url) if s.base_url else "",
                status=s.status,
                degraded_reason=s.degraded_reason,
                degraded_until=s.degraded_until,
                price_input_per_1m=float(s.price_input_per_1m),
                price_output_per_1m=float(s.price_output_per_1m),
                monthly_cost_limit=float(s.monthly_cost_limit) if s.monthly_cost_limit else None,
                call_count_today=s.call_count_today or 0,
                total_tokens_today=s.total_tokens_today or 0,
                total_cost_today=float(s.total_cost_today or 0),
                monthly_cost_used=float(s.monthly_cost_used or 0),
                config_count=config_count,
                last_used_at=s.last_used_at,
                created_at=s.created_at,
                updated_at=s.updated_at,
            )
        )
    return result


@router.post("/secrets", status_code=201, response_model=SecretCreateResponse)
async def create_secret(
    data: ApiSecretCreate,
    current_user: Annotated[User, Depends(require_permission("api_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    for existing in db.query(ApiSecret).all():
        try:
            if decrypt_api_key(existing.encrypted_key) == data.raw_key:
                raise HTTPException(status_code=409, detail="该 API Key 已存在，请勿重复添加")
        except Exception as exc:
            log.debug("decrypt check skipped: %s", exc)
            continue
    suffix = data.raw_key[-4:] if len(data.raw_key) >= 4 else "****"
    s = ApiSecret(
        label=data.label,
        encrypted_key=encrypt_api_key(data.raw_key),
        key_suffix=suffix,
        base_url=data.base_url or "",
        price_input_per_1m=data.price_input_per_1m,
        price_output_per_1m=data.price_output_per_1m,
        monthly_cost_limit=data.monthly_cost_limit,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return {"id": s.id, "key_suffix": s.key_suffix}


@router.put("/secrets/{secret_id}", response_model=OkResponse)
def update_secret(
    secret_id: int,
    data: ApiSecretUpdate,
    current_user: Annotated[User, Depends(require_permission("api_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    s = db.query(ApiSecret).filter(ApiSecret.id == secret_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="档案不存在")
    for field in ("label", "base_url", "price_input_per_1m", "price_output_per_1m", "monthly_cost_limit"):
        val = getattr(data, field, None)
        if val is not None:
            setattr(s, field, val)
    db.commit()
    return {"ok": True}


@router.delete("/secrets/{secret_id}", response_model=OkResponse)
async def delete_secret(
    secret_id: int, current_user: Annotated[User, Depends(require_permission("api_manage"))], db: Annotated[Session, Depends(get_db)]
):
    s = db.query(ApiSecret).filter(ApiSecret.id == secret_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="档案不存在")
    count = db.query(LLMConfig).filter(LLMConfig.secret_id == secret_id).count()
    if count > 0:
        raise HTTPException(status_code=400, detail=f"该档案有 {count} 个用途绑定，先解除")
    db.delete(s)
    db.commit()
    return {"ok": True}


# ── LLMConfig (用途指派) CRUD ──


@router.get("/configs", response_model=list[LLMConfigResponse])
def list_configs(
    purpose: Annotated[str | None, Query()] = None,
    current_user: User = Depends(require_permission("api_manage")),
    db: Session = Depends(get_db),
):
    q = db.query(LLMConfig)
    if purpose:
        q = q.filter(LLMConfig.purpose == purpose)
    configs = q.order_by(LLMConfig.purpose).all()
    secrets_map = {s.id: s for s in db.query(ApiSecret).all()}
    result = []
    for c in configs:
        s = secrets_map.get(c.secret_id)
        result.append(
            LLMConfigResponse(
                id=c.id,
                secret_id=c.secret_id,
                secret_label=s.label if s else "",
                secret_suffix=s.key_suffix if s else "",
                base_url=s.base_url or "" if s else "",
                provider=infer_provider_name(s.base_url) if s and s.base_url else "",
                label=c.label or "",
                model=c.model,
                purpose=c.purpose,
                priority=c.priority or 10,
                weight=c.weight or 10,
                status=c.status,
                price_input_per_1m=float(c.price_input_per_1m or 0),
                price_output_per_1m=float(c.price_output_per_1m or 0),
                monthly_cost_limit=float(c.monthly_cost_limit) if c.monthly_cost_limit is not None else None,
                created_at=c.created_at,
                updated_at=c.updated_at,
            )
        )
    return result


@router.post("/configs", status_code=201, response_model=ConfigCreateResponse)
async def create_config(
    data: LLMConfigCreate,
    request: Request,
    current_user: Annotated[User, Depends(require_permission("api_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    secret = db.query(ApiSecret).filter(ApiSecret.id == data.secret_id).first()
    if not secret:
        raise HTTPException(status_code=404, detail="档案不存在")

    existing = (
        db.query(LLMConfig)
        .filter(
            LLMConfig.secret_id == data.secret_id,
            LLMConfig.purpose == data.purpose,
        )
        .first()
    )
    if existing:
        existing.model = data.model
        existing.label = data.label or ""
        existing.priority = data.priority
        existing.weight = data.weight
        existing.price_input_per_1m = data.price_input_per_1m
        existing.price_output_per_1m = data.price_output_per_1m
        existing.monthly_cost_limit = data.monthly_cost_limit
        existing.status = "active"
        db.commit()
        await request.app.state.llm_router.load_from_db()
        return {"id": existing.id}

    cfg = LLMConfig(
        secret_id=data.secret_id,
        model=data.model,
        purpose=data.purpose,
        label=data.label or "",
        priority=data.priority,
        weight=data.weight,
        price_input_per_1m=data.price_input_per_1m,
        price_output_per_1m=data.price_output_per_1m,
        monthly_cost_limit=data.monthly_cost_limit,
    )
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    await request.app.state.llm_router.load_from_db()
    return {"id": cfg.id}


@router.put("/configs/{config_id}", response_model=OkResponse)
async def update_config(
    config_id: int,
    data: LLMConfigUpdate,
    request: Request,
    current_user: Annotated[User, Depends(require_permission("api_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="指派不存在")
    for f in ("secret_id", "model", "purpose", "status", "label", "priority", "weight", "price_input_per_1m", "price_output_per_1m", "monthly_cost_limit"):
        val = getattr(data, f, None)
        if val is not None:
            setattr(cfg, f, val)
    db.commit()
    await request.app.state.llm_router.load_from_db()
    return {"ok": True}


@router.delete("/configs/{config_id}", response_model=OkResponse)
async def delete_config(
    config_id: int, request: Request, current_user: Annotated[User, Depends(require_permission("api_manage"))], db: Annotated[Session, Depends(get_db)]
):
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="指派不存在")
    db.delete(cfg)
    db.commit()
    await request.app.state.llm_router.load_from_db()
    return {"ok": True}


@router.post("/configs/{config_id}/toggle", response_model=ToggleStatusResponse)
async def toggle_config(
    config_id: int, request: Request, current_user: Annotated[User, Depends(require_permission("api_manage"))], db: Annotated[Session, Depends(get_db)]
):
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="指派不存在")
    cfg.status = "active" if cfg.status == "disabled" else "disabled"
    db.commit()
    await request.app.state.llm_router.load_from_db()
    return {"ok": True, "status": cfg.status}


@router.post("/configs/{config_id}/reset", response_model=OkResponse)
async def reset_profile(
    config_id: int, request: Request, current_user: Annotated[User, Depends(require_permission("api_manage"))], db: Annotated[Session, Depends(get_db)]
):
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="指派不存在")
    secret = db.query(ApiSecret).filter(ApiSecret.id == cfg.secret_id).first()
    if secret:
        secret.status = "active"
        secret.degraded_reason = None
        secret.degraded_until = None
        secret.consecutive_failures = 0
    cfg.status = "active"
    db.commit()
    await request.app.state.llm_router.load_from_db()
    return {"ok": True}


@router.post("/configs/{config_id}/test", response_model=TestResultItem)
async def test_config(
    config_id: int, current_user: Annotated[User, Depends(require_permission("api_manage"))], db: Annotated[Session, Depends(get_db)]
):
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="指派不存在")
    secret = db.query(ApiSecret).filter(ApiSecret.id == cfg.secret_id).first()
    api_key = decrypt_api_key(secret.encrypted_key)
    base_url = secret.base_url or ""
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10)) as client:
            t0 = time.monotonic()
            resp = await client.get(f"{base_url}/v1/models", headers={"Authorization": f"Bearer {api_key}"})
            latency = int((time.monotonic() - t0) * 1000)
            return {"base_url": base_url, "ok": True, "status_code": resp.status_code, "latency_ms": latency}
    except Exception as e:
        return {"base_url": base_url, "ok": False, "error": str(e)[:200]}


@router.post("/configs/test-all", response_model=TestAllResultsResponse)
async def test_all_configs(
    current_user: Annotated[User, Depends(require_permission("api_manage"))], db: Annotated[Session, Depends(get_db)]
):
    secrets = db.query(ApiSecret).all()
    results = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(8)) as client:
        for s in secrets:
            api_key = decrypt_api_key(s.encrypted_key)
            base_url = s.base_url or ""
            try:
                t0 = time.monotonic()
                resp = await client.get(f"{base_url}/v1/models", headers={"Authorization": f"Bearer {api_key}"})
                latency = int((time.monotonic() - t0) * 1000)
                results.append(
                    {
                        "base_url": base_url,
                        "ok": resp.status_code < 500,
                        "status_code": resp.status_code,
                        "latency_ms": latency,
                    }
                )
            except Exception as e:
                results.append({"base_url": base_url, "ok": False, "error": str(e)[:100]})
    return {"results": results}


# ── Reload & Catalog ──


@router.post("/reload", response_model=OkResponse)
async def reload_router(request: Request, current_user: Annotated[User, Depends(require_permission("api_manage"))]):
    await request.app.state.llm_router.load_from_db()
    return {"ok": True}


@router.get("/model-presets", response_model=CatalogResponse)
def list_model_presets(current_user: Annotated[User, Depends(require_permission("api_manage"))]):
    catalog = get_catalog()
    providers = []
    for p in catalog["providers"]:
        models = [
            ModelPresetItem(name=m["name"], price_input=m.get("price_input", 0), price_output=m.get("price_output", 0))
            for m in p.get("models", [])
        ]
        providers.append(
            ProviderPresetResponse(
                provider=p["id"],
                display_name=p.get("display_name", p["id"]),
                base_url=p.get("base_url", ""),
                models=models,
            )
        )
    return CatalogResponse(providers=providers)


# ── Health ──


@router.get("/health", response_model=list[HealthCheckItem])
async def health_check(
    current_user: Annotated[User, Depends(require_permission("api_manage"))], db: Annotated[Session, Depends(get_db)]
):
    secrets = db.query(ApiSecret).all()
    results = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(5)) as client:
        for s in secrets:
            api_key = decrypt_api_key(s.encrypted_key)
            headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
            try:
                t0 = time.monotonic()
                resp = await client.get(f"{s.base_url}/v1/models", headers=headers)
                latency = int((time.monotonic() - t0) * 1000)
                results.append(
                    {
                        "base_url": s.base_url,
                        "status": "ok" if resp.status_code < 500 else "error",
                        "latency_ms": latency,
                        "error": None,
                    }
                )
            except Exception as e:
                results.append({"base_url": s.base_url, "status": "error", "latency_ms": None, "error": str(e)[:200]})
    return results


# ── Env Fallback ──


@router.get("/fallback")
async def get_env_fallback(current_user: Annotated[User, Depends(require_permission("api_manage"))]):

    return await get_env_fallback_state()


@router.post("/fallback/test", response_model=TestResultItem)
async def test_env_fallback(current_user: Annotated[User, Depends(require_permission("api_manage"))]):
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


# ── Rubric CRUD (unchanged) ──


@router.get("/rubrics", response_model=list[RubricResponse])
def list_rubrics(current_user: Annotated[User, Depends(require_permission("api_manage"))], db: Annotated[Session, Depends(get_db)]):
    return db.query(Rubric).order_by(Rubric.created_at.desc()).all()


@router.get("/rubrics/active", response_model=RubricResponse)
def get_active_rubric(current_user: Annotated[User, Depends(require_permission("api_manage"))]):
    from contexts.training.service import load_active_rubric

    active = load_active_rubric()
    if not active:
        raise HTTPException(status_code=404, detail="没有激活的评分标准")
    return active


@router.post("/rubrics", status_code=201, response_model=RubricResponse)
def create_rubric(
    data: dict, current_user: Annotated[User, Depends(require_permission("api_manage"))], db: Annotated[Session, Depends(get_db)]
):
    from contexts.training.service import validate_dimensions

    dims = data.get("dimensions")
    if not dims:
        raise HTTPException(status_code=400, detail="dimensions 不能为空")
    errors = validate_dimensions(dims)
    if errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))
    rubric = Rubric(
        name=data.get("name", ""),
        version=data.get("version", "1.0"),
        description=data.get("description"),
        total_max=data.get("total_max", 100),
        raw_max=data.get("raw_max", 57),
        raw_scale=data.get("raw_scale", 3),
        dimensions=dims,
    )
    db.add(rubric)
    db.commit()
    db.refresh(rubric)
    return rubric


@router.put("/rubrics/{rubric_id}", response_model=RubricResponse)
def update_rubric(
    rubric_id: int,
    data: dict,
    current_user: Annotated[User, Depends(require_permission("api_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    from contexts.training.service import validate_dimensions

    rubric = db.query(Rubric).filter(Rubric.id == rubric_id).first()
    if not rubric:
        raise HTTPException(status_code=404, detail="评分标准不存在")
    if "dimensions" in data:
        errors = validate_dimensions(data["dimensions"])
        if errors:
            raise HTTPException(status_code=400, detail="; ".join(errors))
        rubric.dimensions = data["dimensions"]
    for field in ("name", "version", "description", "total_max", "raw_max", "raw_scale"):
        if field in data:
            setattr(rubric, field, data[field])
    db.commit()
    return rubric


@router.delete("/rubrics/{rubric_id}", response_model=OkResponse)
def delete_rubric(
    rubric_id: int, current_user: Annotated[User, Depends(require_permission("api_manage"))], db: Annotated[Session, Depends(get_db)]
):
    rubric = db.query(Rubric).filter(Rubric.id == rubric_id).first()
    if not rubric:
        raise HTTPException(status_code=404, detail="评分标准不存在")
    if rubric.is_active:
        raise HTTPException(status_code=400, detail="不能删除当前激活的评分标准")
    db.delete(rubric)
    db.commit()
    return {"ok": True}


@router.post("/rubrics/{rubric_id}/activate", response_model=OkResponse)
def activate_rubric(
    rubric_id: int, current_user: Annotated[User, Depends(require_permission("api_manage"))], db: Annotated[Session, Depends(get_db)]
):
    rubric = db.query(Rubric).filter(Rubric.id == rubric_id).first()
    if not rubric:
        raise HTTPException(status_code=404, detail="评分标准不存在")
    db.query(Rubric).update({"is_active": False})
    rubric.is_active = True
    db.commit()
    return {"ok": True}
