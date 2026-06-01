"""API 管理 CRUD —— ApiSecret + LLMConfig"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from models import User, ApiSecret, LLMConfig
from schemas import (
    ApiSecretCreate, ApiSecretUpdate, ApiSecretResponse,
    LLMConfigCreate, LLMConfigUpdate, LLMConfigResponse,
)
from auth import require_teacher
from services.llm_router import refresh_router
from services.crypto_utils import encrypt_api_key, decrypt_api_key
from datetime import datetime, timezone
import httpx
import time

router = APIRouter(prefix="/api/admin/api", tags=["API管理"])


# ── ApiSecret CRUD ──

@router.get("/secrets", response_model=list[ApiSecretResponse])
def list_secrets(
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    secrets = db.query(ApiSecret).order_by(ApiSecret.created_at.desc()).all()
    result = []
    for s in secrets:
        config_count = db.query(LLMConfig).filter(LLMConfig.secret_id == s.id).count()
        cost_agg = db.query(
            func.coalesce(func.sum(LLMConfig.total_cost_today), 0),
            func.coalesce(func.sum(LLMConfig.monthly_cost_used), 0),
        ).filter(LLMConfig.secret_id == s.id).first()
        result.append(ApiSecretResponse(
            id=s.id, label=s.label, key_suffix=s.key_suffix,
            config_count=config_count,
            total_cost_today=float(cost_agg[0]),
            monthly_cost_used=float(cost_agg[1]),
            created_at=s.created_at, updated_at=s.updated_at,
        ))
    return result


@router.post("/secrets", status_code=201)
async def create_secret(
    data: ApiSecretCreate,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    suffix = data.raw_key[-4:] if len(data.raw_key) >= 4 else "****"
    s = ApiSecret(
        label=data.label,
        encrypted_key=encrypt_api_key(data.raw_key),
        key_suffix=suffix,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return {"id": s.id, "key_suffix": s.key_suffix}


@router.put("/secrets/{secret_id}")
def update_secret(
    secret_id: int,
    data: ApiSecretUpdate,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    s = db.query(ApiSecret).filter(ApiSecret.id == secret_id).first()
    if not s:
        raise HTTPException(404, "Secret 不存在")
    if data.label is not None:
        s.label = data.label
    db.commit()
    return {"ok": True}


@router.delete("/secrets/{secret_id}")
async def delete_secret(
    secret_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    s = db.query(ApiSecret).filter(ApiSecret.id == secret_id).first()
    if not s:
        raise HTTPException(404, "Secret 不存在")
    config_count = db.query(LLMConfig).filter(LLMConfig.secret_id == secret_id).count()
    if config_count > 0:
        raise HTTPException(400, f"该 Secret 关联了 {config_count} 个配置，请先删除配置")
    db.delete(s)
    db.commit()
    return {"ok": True}


# ── LLMConfig CRUD ──

@router.get("/configs", response_model=list[LLMConfigResponse])
def list_configs(
    purpose: str | None = Query(None),
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    q = db.query(LLMConfig)
    if purpose:
        q = q.filter(LLMConfig.purpose == purpose)
    configs = q.order_by(LLMConfig.purpose, LLMConfig.priority).all()
    result = []
    for c in configs:
        secret = db.query(ApiSecret).filter(ApiSecret.id == c.secret_id).first()
        result.append(LLMConfigResponse(
            id=c.id, secret_id=c.secret_id,
            secret_label=secret.label if secret else "",
            secret_suffix=secret.key_suffix if secret else "",
            label=c.label, base_url=c.base_url, model=c.model,
            purpose=c.purpose, priority=c.priority,
            status=c.status,
            degraded_reason=c.degraded_reason,
            degraded_until=c.degraded_until,
            price_input_per_1m=float(c.price_input_per_1m),
            price_output_per_1m=float(c.price_output_per_1m),
            monthly_cost_limit=float(c.monthly_cost_limit) if c.monthly_cost_limit else None,
            call_count_today=c.call_count_today or 0,
            total_tokens_today=c.total_tokens_today or 0,
            total_cost_today=float(c.total_cost_today or 0),
            monthly_cost_used=float(c.monthly_cost_used or 0),
            consecutive_failures=c.consecutive_failures or 0,
            last_used_at=c.last_used_at,
            created_at=c.created_at, updated_at=c.updated_at,
        ))
    return result


@router.post("/configs", status_code=201)
async def create_config(
    data: LLMConfigCreate,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    secret = db.query(ApiSecret).filter(ApiSecret.id == data.secret_id).first()
    if not secret:
        raise HTTPException(404, "Secret 不存在")

    existing = db.query(LLMConfig).filter(
        LLMConfig.purpose == data.purpose,
        LLMConfig.priority == data.priority,
    ).first()
    if existing:
        raise HTTPException(400, f"purpose={data.purpose} priority={data.priority} 已存在")

    cfg = LLMConfig(
        secret_id=data.secret_id,
        label=data.label or f"{secret.label}-{data.purpose}",
        base_url=data.base_url,
        model=data.model,
        purpose=data.purpose,
        priority=data.priority,
        price_input_per_1m=data.price_input_per_1m,
        price_output_per_1m=data.price_output_per_1m,
        monthly_cost_limit=data.monthly_cost_limit,
    )
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    await refresh_router()
    return {"id": cfg.id}


@router.put("/configs/{config_id}")
async def update_config(
    config_id: int,
    data: LLMConfigUpdate,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(404, "Config 不存在")

    update_data = data.model_dump(exclude_none=True)
    for k, v in update_data.items():
        setattr(cfg, k, v)

    db.commit()
    await refresh_router()
    return {"ok": True}


@router.delete("/configs/{config_id}")
async def delete_config(
    config_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(404, "Config 不存在")
    db.delete(cfg)
    db.commit()
    await refresh_router()
    return {"ok": True}


@router.post("/configs/{config_id}/toggle")
async def toggle_config(
    config_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(404, "Config 不存在")
    if cfg.status == "disabled":
        cfg.status = "active"
        cfg.degraded_reason = None
        cfg.degraded_until = None
        cfg.consecutive_failures = 0
    else:
        cfg.status = "disabled"
    db.commit()
    await refresh_router()
    return {"ok": True, "status": cfg.status}


@router.post("/configs/{config_id}/reset")
async def reset_config(
    config_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(404, "Config 不存在")
    cfg.status = "active"
    cfg.degraded_reason = None
    cfg.degraded_until = None
    cfg.consecutive_failures = 0
    db.commit()
    await refresh_router()
    return {"ok": True}


@router.post("/configs/{config_id}/test")
async def test_config(
    config_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(404, "Config 不存在")
    secret = db.query(ApiSecret).filter(ApiSecret.id == cfg.secret_id).first()
    api_key = decrypt_api_key(secret.encrypted_key)

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10)) as client:
            t0 = time.monotonic()
            resp = await client.get(
                f"{cfg.base_url}/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            latency = int((time.monotonic() - t0) * 1000)
            return {"ok": True, "status_code": resp.status_code, "latency_ms": latency}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


@router.post("/configs/test-all")
async def test_all_configs(
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    configs = db.query(LLMConfig).order_by(LLMConfig.purpose, LLMConfig.priority).all()
    results = []
    seen = {}
    async with httpx.AsyncClient(timeout=httpx.Timeout(8)) as client:
        for cfg in configs:
            cache_key = (cfg.base_url, cfg.secret_id)
            if cache_key in seen:
                results.append({**seen[cache_key], "id": cfg.id, "purpose": cfg.purpose, "label": cfg.label, "model": cfg.model, "cached": True})
                continue
            secret = db.query(ApiSecret).filter(ApiSecret.id == cfg.secret_id).first()
            api_key = decrypt_api_key(secret.encrypted_key)
            try:
                t0 = time.monotonic()
                resp = await client.get(f"{cfg.base_url}/v1/models", headers={"Authorization": f"Bearer {api_key}"})
                latency = int((time.monotonic() - t0) * 1000)
                r = {"id": cfg.id, "purpose": cfg.purpose, "label": cfg.label, "model": cfg.model, "ok": resp.status_code < 500, "latency_ms": latency, "detail": str(resp.status_code), "cached": False}
            except Exception as e:
                r = {"id": cfg.id, "purpose": cfg.purpose, "label": cfg.label, "model": cfg.model, "ok": False, "latency_ms": None, "detail": str(e)[:100], "cached": False}
            seen[cache_key] = r
            results.append(r)
    return {"results": results}


# ── Reload & Health ──

@router.post("/reload")
async def reload_router(current_user: User = Depends(require_teacher)):
    await refresh_router()
    return {"ok": True}


@router.get("/health")
async def health_check(
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    configs = db.query(LLMConfig).distinct(LLMConfig.base_url).all()
    results = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(5)) as client:
        for c in configs:
            try:
                t0 = time.monotonic()
                resp = await client.get(f"{c.base_url}/v1/models")
                latency = int((time.monotonic() - t0) * 1000)
                results.append({
                    "base_url": c.base_url,
                    "status": "ok" if resp.status_code < 500 else "error",
                    "latency_ms": latency,
                    "error": None,
                })
            except Exception as e:
                results.append({
                    "base_url": c.base_url,
                    "status": "error",
                    "latency_ms": None,
                    "error": str(e)[:200],
                })
    return results
