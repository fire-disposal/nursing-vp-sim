"""API Key/Provider 管理 CRUD"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from models import User, ApiProvider, ApiKey, LLMCallLog
from schemas import (
    ApiProviderCreate, ApiProviderUpdate, ApiProviderResponse,
    ApiKeyCreate, ApiKeyUpdate, ApiKeyResponse,
    ApiHealthResponse,
)
from auth import require_teacher
from services.llm_router import refresh_router
from services.crypto_utils import encrypt_api_key
from datetime import datetime, timezone, timedelta
import httpx

router = APIRouter(prefix="/api/admin/api", tags=["API管理"])

# --- Providers ---

@router.get("/providers", response_model=list[ApiProviderResponse])
def list_providers(
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    providers = db.query(ApiProvider).order_by(ApiProvider.priority).all()
    result = []
    for p in providers:
        key_count = db.query(ApiKey).filter(ApiKey.provider_id == p.id).count()
        result.append(ApiProviderResponse(
            id=p.id, name=p.name, display_name=p.display_name, base_url=p.base_url,
            api_type=p.api_type, default_model=p.default_model,
            is_enabled=p.is_enabled, priority=p.priority, key_count=key_count,
            created_at=p.created_at, updated_at=p.updated_at,
        ))
    return result

@router.post("/providers", status_code=201)
def create_provider(
    data: ApiProviderCreate,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    if db.query(ApiProvider).filter(ApiProvider.name == data.name).first():
        raise HTTPException(400, f"Provider {data.name} 已存在")
    p = ApiProvider(**data.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return {"id": p.id, "name": p.name}

@router.put("/providers/{provider_id}")
def update_provider(
    provider_id: int,
    data: ApiProviderUpdate,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    p = db.query(ApiProvider).filter(ApiProvider.id == provider_id).first()
    if not p:
        raise HTTPException(404, "Provider 不存在")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(p, k, v)
    db.commit()
    return {"ok": True}

@router.delete("/providers/{provider_id}")
def delete_provider(
    provider_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    p = db.query(ApiProvider).filter(ApiProvider.id == provider_id).first()
    if not p:
        raise HTTPException(404, "Provider 不存在")
    key_count = db.query(ApiKey).filter(ApiKey.provider_id == provider_id).count()
    if key_count > 0:
        raise HTTPException(400, f"请先删除该 provider 下的 {key_count} 个 key")
    db.delete(p)
    db.commit()
    return {"ok": True}

# --- Keys ---

@router.get("/keys", response_model=list[ApiKeyResponse])
def list_keys(
    provider_id: int | None = Query(None),
    status: str | None = Query(None),
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    q = db.query(ApiKey)
    if provider_id:
        q = q.filter(ApiKey.provider_id == provider_id)
    if status:
        q = q.filter(ApiKey.status == status)
    keys = q.order_by(ApiKey.created_at.desc()).all()
    result = []
    for k in keys:
        provider = db.query(ApiProvider).filter(ApiProvider.id == k.provider_id).first()
        result.append(ApiKeyResponse(
            id=k.id, provider_id=k.provider_id,
            provider_name=provider.name if provider else "",
            purpose=k.purpose,
            priority=k.priority,
            label=k.label, key_suffix=k.key_suffix, model=k.model,
            weight=k.weight, status=k.status,
            price_input_per_1m=float(k.price_input_per_1m),
            price_output_per_1m=float(k.price_output_per_1m),
            balance=float(k.balance) if k.balance else None,
            monthly_cost_limit=float(k.monthly_cost_limit) if k.monthly_cost_limit else None,
            call_count_today=k.call_count_today,
            total_tokens_today=k.total_tokens_today,
            total_cost_today=float(k.total_cost_today),
            last_used_at=k.last_used_at, rate_limit_until=k.rate_limit_until,
            consecutive_failures=k.consecutive_failures, created_at=k.created_at,
        ))
    return result

@router.post("/keys", status_code=201)
async def create_key(
    data: ApiKeyCreate,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    provider = db.query(ApiProvider).filter(ApiProvider.id == data.provider_id).first()
    if not provider:
        raise HTTPException(404, "Provider 不存在")
    suffix = data.raw_key[-4:] if len(data.raw_key) >= 4 else "****"
    label = data.label or f"{provider.display_name}-{suffix}"
    k = ApiKey(
        provider_id=data.provider_id, label=label,
        encrypted_key=encrypt_api_key(data.raw_key), key_suffix=suffix,
        model=data.model or provider.default_model,
        purpose=data.purpose,
        priority=data.priority,
        weight=data.weight,
        status="active",
        price_input_per_1m=data.price_input_per_1m,
        price_output_per_1m=data.price_output_per_1m,
        monthly_cost_limit=data.monthly_cost_limit,
    )
    db.add(k)
    db.commit()
    db.refresh(k)
    await refresh_router()
    return {"id": k.id, "key_suffix": k.key_suffix}

@router.put("/keys/{key_id}")
async def update_key(
    key_id: int,
    data: ApiKeyUpdate,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    k = db.query(ApiKey).filter(ApiKey.id == key_id).first()
    if not k:
        raise HTTPException(404, "Key 不存在")
    for field, val in data.model_dump(exclude_none=True).items():
        setattr(k, field, val)
    db.commit()
    await refresh_router()
    return {"ok": True}

@router.delete("/keys/{key_id}")
async def delete_key(
    key_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    k = db.query(ApiKey).filter(ApiKey.id == key_id).first()
    if not k:
        raise HTTPException(404, "Key 不存在")
    db.delete(k)
    db.commit()
    await refresh_router()
    return {"ok": True}

@router.post("/keys/{key_id}/reset")
async def reset_key(
    key_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    k = db.query(ApiKey).filter(ApiKey.id == key_id).first()
    if not k:
        raise HTTPException(404, "Key 不存在")
    k.status = "active"
    k.consecutive_failures = 0
    k.rate_limit_until = None
    db.commit()
    await refresh_router()
    return {"ok": True}

# --- Key Stats ---

@router.get("/keys/{key_id}/stats")
def key_stats(
    key_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    thirty_days = datetime.now(timezone.utc) - timedelta(days=30)
    daily_rows = db.query(
        func.date(LLMCallLog.created_at).label("day"),
        func.count().label("calls"),
        func.coalesce(func.sum(LLMCallLog.total_tokens), 0).label("tokens"),
        func.coalesce(func.sum(LLMCallLog.estimated_cost), 0).label("cost"),
    ).filter(
        LLMCallLog.api_key_id == key_id,
        LLMCallLog.created_at >= thirty_days,
    ).group_by("day").order_by("day").all()
    daily = [{"date": str(r.day), "calls": r.calls, "tokens": int(r.tokens), "cost": float(r.cost)} for r in daily_rows]

    purpose_rows = db.query(
        LLMCallLog.purpose,
        func.count().label("calls"),
        func.coalesce(func.sum(LLMCallLog.total_tokens), 0).label("tokens"),
        func.coalesce(func.sum(LLMCallLog.estimated_cost), 0).label("cost"),
    ).filter(LLMCallLog.api_key_id == key_id).group_by(LLMCallLog.purpose).all()
    by_purpose = [{"purpose": r.purpose, "calls": r.calls, "tokens": int(r.tokens), "cost": float(r.cost)} for r in purpose_rows]

    errors = db.query(LLMCallLog).filter(
        LLMCallLog.api_key_id == key_id, LLMCallLog.status != "success",
    ).order_by(LLMCallLog.created_at.desc()).limit(20).all()
    recent_errors = [{"created_at": str(e.created_at), "error_type": e.error_type, "error_message": e.error_message} for e in errors]

    return {"daily": daily, "by_purpose": by_purpose, "recent_errors": recent_errors}

# --- Health ---

@router.post("/reload")
async def reload_router(current_user: User = Depends(require_teacher)):
    await refresh_router()
    return {"ok": True}

@router.get("/health", response_model=list[ApiHealthResponse])
async def health_check(current_user: User = Depends(require_teacher), db: Session = Depends(get_db)):
    providers = db.query(ApiProvider).filter(ApiProvider.is_enabled == True).all()
    results = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(5)) as client:
        for p in providers:
            import time
            try:
                t0 = time.monotonic()
                resp = await client.get(f"{p.base_url}/v1/models")
                latency = int((time.monotonic() - t0) * 1000)
                results.append(ApiHealthResponse(
                    provider_id=p.id, provider_name=p.name,
                    status="ok" if resp.status_code < 500 else "error",
                    latency_ms=latency, error=None,
                ))
            except Exception as e:
                results.append(ApiHealthResponse(
                    provider_id=p.id, provider_name=p.name,
                    status="error", latency_ms=None, error=str(e)[:200],
                ))
    return results


@router.get("/stats")
def api_aggregate_stats(
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    """API 使用聚合统计：总量概览 + 按 key/provider 细分"""
    today = datetime.now(timezone.utc).date()
    month = today.strftime("%Y-%m")

    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = today_start.replace(day=1)

    today_stats = db.query(
        func.count(LLMCallLog.id),
        func.coalesce(func.sum(LLMCallLog.total_tokens), 0),
        func.coalesce(func.sum(LLMCallLog.estimated_cost), 0),
        func.coalesce(func.avg(LLMCallLog.latency_ms), 0),
    ).filter(LLMCallLog.created_at >= today_start).first()

    month_stats = db.query(
        func.count(LLMCallLog.id),
        func.coalesce(func.sum(LLMCallLog.total_tokens), 0),
        func.coalesce(func.sum(LLMCallLog.estimated_cost), 0),
    ).filter(LLMCallLog.created_at >= month_start).first()

    success_count = db.query(func.count(LLMCallLog.id)).filter(
        LLMCallLog.created_at >= today_start, LLMCallLog.status == "success"
    ).scalar() or 0
    total_count = today_stats[0] or 0
    success_rate = round(success_count / total_count * 100, 1) if total_count > 0 else 0

    active_keys = db.query(ApiKey).filter(ApiKey.status == "active").count()
    total_keys = db.query(ApiKey).count()

    return {
        "today": {
            "calls": today_stats[0] or 0,
            "tokens": int(today_stats[1]),
            "cost": round(float(today_stats[2]), 6),
            "avg_latency_ms": round(float(today_stats[3]), 0),
            "success_rate": success_rate,
        },
        "month": {
            "calls": month_stats[0] or 0,
            "tokens": int(month_stats[1]),
            "cost": round(float(month_stats[2]), 6),
        },
        "keys": {"active": active_keys, "total": total_keys},
    }
