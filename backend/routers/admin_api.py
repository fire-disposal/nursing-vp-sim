"""API 管理 CRUD —— ApiSecret + LLMConfig"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from models import User, ApiSecret, LLMConfig, Rubric
from schemas import (
    ApiSecretCreate, ApiSecretUpdate, ApiSecretResponse,
    LLMConfigCreate, LLMConfigUpdate, LLMConfigResponse,
    OkResponse, ToggleStatusResponse,
    SecretCreateResponse, ConfigCreateResponse,
    TestResultItem, TestAllResultsResponse,
    HealthCheckItem,
    RubricResponse, RubricBrief,
    CatalogResponse, ProviderPresetResponse, ModelPresetItem,
)
from auth import require_teacher
from services.llm_router import refresh_router
from services.crypto_utils import encrypt_api_key, decrypt_api_key
from services.provider_catalog import get_catalog, infer_provider_name, match_provider
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
            base_url=s.base_url or "",
            provider=infer_provider_name(s.base_url) if s.base_url else "",
            config_count=config_count,
            total_cost_today=float(cost_agg[0]),
            monthly_cost_used=float(cost_agg[1]),
            created_at=s.created_at, updated_at=s.updated_at,
        ))
    return result


@router.post("/secrets", status_code=201, response_model=SecretCreateResponse)
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
        base_url=data.base_url or "",
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return {"id": s.id, "key_suffix": s.key_suffix}


@router.put("/secrets/{secret_id}", response_model=OkResponse)
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
    if data.base_url is not None:
        s.base_url = data.base_url
    db.commit()
    return {"ok": True}


@router.delete("/secrets/{secret_id}", response_model=OkResponse)
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
    secrets_map = {s.id: s for s in db.query(ApiSecret).all()}
    result = []
    for c in configs:
        secret = secrets_map.get(c.secret_id)
        effective_base_url = (secret.base_url or c.base_url or "") if secret else (c.base_url or "")
        provider = infer_provider_name(effective_base_url) if effective_base_url else ""
        result.append(LLMConfigResponse(
            id=c.id, secret_id=c.secret_id,
            secret_label=secret.label if secret else "",
            secret_suffix=secret.key_suffix if secret else "",
            label=c.label,
            base_url=effective_base_url,
            provider=provider,
            model=c.model, purpose=c.purpose,
            priority=c.priority, weight=c.weight or 1,
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


@router.post("/configs", status_code=201, response_model=ConfigCreateResponse)
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
        max_p = db.query(func.max(LLMConfig.priority)).filter(LLMConfig.purpose == data.purpose).scalar()
        new_priority = (max_p or 0) + 10
    else:
        new_priority = data.priority

    cfg = LLMConfig(
        secret_id=data.secret_id,
        label=data.label or f"{secret.label}-{data.purpose}",
        base_url=secret.base_url or "",
        model=data.model,
        purpose=data.purpose,
        priority=new_priority,
        weight=data.weight,
        price_input_per_1m=data.price_input_per_1m,
        price_output_per_1m=data.price_output_per_1m,
        monthly_cost_limit=data.monthly_cost_limit,
    )
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    await refresh_router()
    return {"id": cfg.id}


@router.put("/configs/{config_id}", response_model=OkResponse)
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


@router.delete("/configs/{config_id}", response_model=OkResponse)
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


@router.post("/configs/{config_id}/toggle", response_model=ToggleStatusResponse)
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


@router.post("/configs/{config_id}/reset", response_model=OkResponse)
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


@router.post("/configs/{config_id}/test", response_model=TestResultItem)
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
    base_url = (secret.base_url or cfg.base_url or "")

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10)) as client:
            t0 = time.monotonic()
            resp = await client.get(
                f"{base_url}/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            latency = int((time.monotonic() - t0) * 1000)
            return {"base_url": base_url, "ok": True, "status_code": resp.status_code, "latency_ms": latency}
    except Exception as e:
        return {"base_url": base_url, "ok": False, "error": str(e)[:200]}


@router.post("/configs/test-all", response_model=TestAllResultsResponse)
async def test_all_configs(
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    configs = db.query(LLMConfig).order_by(LLMConfig.purpose, LLMConfig.priority).all()
    results = []
    seen = {}
    async with httpx.AsyncClient(timeout=httpx.Timeout(8)) as client:
        for cfg in configs:
            secret = db.query(ApiSecret).filter(ApiSecret.id == cfg.secret_id).first()
            base_url = (secret.base_url or cfg.base_url or "") if secret else (cfg.base_url or "")
            cache_key = (base_url, cfg.secret_id)
            if cache_key in seen:
                seen[cache_key].update({"base_url": base_url})
                results.append(seen[cache_key].copy())
                continue
            api_key = decrypt_api_key(secret.encrypted_key)
            try:
                t0 = time.monotonic()
                resp = await client.get(f"{base_url}/v1/models", headers={"Authorization": f"Bearer {api_key}"})
                latency = int((time.monotonic() - t0) * 1000)
                r = {"base_url": base_url, "ok": resp.status_code < 500, "status_code": resp.status_code, "latency_ms": latency}
            except Exception as e:
                r = {"base_url": base_url, "ok": False, "latency_ms": None, "error": str(e)[:100]}
            seen[cache_key] = r
            results.append(r)
    return {"results": results}


# ── Reload & Health ──

@router.post("/reload", response_model=OkResponse)
async def reload_router(current_user: User = Depends(require_teacher)):
    await refresh_router()
    return {"ok": True}


# ── 环境兜底状态 ──

@router.get("/fallback")
def get_env_fallback(
    current_user: User = Depends(require_teacher),
):
    from services.llm_router import get_env_fallback_state
    return get_env_fallback_state()


@router.post("/fallback/test", response_model=TestResultItem)
async def test_env_fallback(
    current_user: User = Depends(require_teacher),
):
    from config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL
    if not DEEPSEEK_API_KEY:
        return {"base_url": DEEPSEEK_BASE_URL, "ok": False, "error": "DEEPSEEK_API_KEY 未设置"}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10)) as client:
            t0 = time.monotonic()
            resp = await client.get(
                f"{DEEPSEEK_BASE_URL}/v1/models",
                headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}"},
            )
            latency = int((time.monotonic() - t0) * 1000)
            return {"base_url": DEEPSEEK_BASE_URL, "ok": resp.status_code < 400, "status_code": resp.status_code, "latency_ms": latency}
    except Exception as e:
        return {"base_url": DEEPSEEK_BASE_URL, "ok": False, "error": str(e)[:200]}


@router.get("/health", response_model=list[HealthCheckItem])
async def health_check(
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    configs = db.query(LLMConfig).all()
    # 按 base_url 去重，取每个端点的第一个 config 关联的 key
    seen = {}
    for c in configs:
        secret = db.query(ApiSecret).filter(ApiSecret.id == c.secret_id).first()
        effective_url = (secret.base_url or c.base_url or "") if secret else (c.base_url or "")
        if effective_url not in seen:
            seen[effective_url] = (c, secret)
    results = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(5)) as client:
        for base_url, (cfg, secret) in seen.items():
            api_key = decrypt_api_key(secret.encrypted_key) if secret else None
            headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
            try:
                t0 = time.monotonic()
                resp = await client.get(f"{base_url}/v1/models", headers=headers)
                latency = int((time.monotonic() - t0) * 1000)
                results.append({
                    "base_url": base_url,
                    "status": "ok" if resp.status_code < 500 else "error",
                    "latency_ms": latency,
                    "error": None,
                })
            except Exception as e:
                results.append({
                    "base_url": base_url,
                    "status": "error",
                    "latency_ms": None,
                    "error": str(e)[:200],
                })
    return results


# ── Provider Catalog ──

@router.get("/model-presets", response_model=CatalogResponse)
def list_model_presets(
    current_user: User = Depends(require_teacher),
):
    catalog = get_catalog()
    providers = []
    for p in catalog["providers"]:
        models = [
            ModelPresetItem(
                name=m["name"],
                price_input=m.get("price_input", 0),
                price_output=m.get("price_output", 0),
            )
            for m in p.get("models", [])
        ]
        providers.append(ProviderPresetResponse(
            provider=p["id"],
            display_name=p.get("display_name", p["id"]),
            base_url=p.get("base_url", ""),
            models=models,
        ))
    return CatalogResponse(providers=providers)


# ── Rubric CRUD ──

@router.get("/rubrics", response_model=list[RubricBrief])
def list_rubrics(current_user: User = Depends(require_teacher), db: Session = Depends(get_db)):
    from models import Rubric
    return db.query(Rubric).order_by(Rubric.created_at.desc()).all()


@router.get("/rubrics/active", response_model=RubricResponse)
def get_active_rubric(current_user: User = Depends(require_teacher)):
    from services.rubric_service import load_active_rubric
    active = load_active_rubric()
    if not active:
        raise HTTPException(404, "没有激活的评分标准")
    return active


@router.post("/rubrics", status_code=201, response_model=RubricResponse)
def create_rubric(data: dict, current_user: User = Depends(require_teacher), db: Session = Depends(get_db)):
    from models import Rubric
    from services.rubric_service import validate_dimensions

    dims = data.get("dimensions")
    if not dims:
        raise HTTPException(400, "dimensions 不能为空")
    errors = validate_dimensions(dims)
    if errors:
        raise HTTPException(400, "; ".join(errors))

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
def update_rubric(rubric_id: int, data: dict, current_user: User = Depends(require_teacher), db: Session = Depends(get_db)):
    from models import Rubric
    from services.rubric_service import validate_dimensions

    rubric = db.query(Rubric).filter(Rubric.id == rubric_id).first()
    if not rubric:
        raise HTTPException(404, "评分标准不存在")

    if "dimensions" in data:
        errors = validate_dimensions(data["dimensions"])
        if errors:
            raise HTTPException(400, "; ".join(errors))
        rubric.dimensions = data["dimensions"]
    for field in ("name", "version", "description", "total_max", "raw_max", "raw_scale"):
        if field in data:
            setattr(rubric, field, data[field])

    db.commit()
    return rubric


@router.delete("/rubrics/{rubric_id}", response_model=OkResponse)
def delete_rubric(rubric_id: int, current_user: User = Depends(require_teacher), db: Session = Depends(get_db)):
    from models import Rubric
    rubric = db.query(Rubric).filter(Rubric.id == rubric_id).first()
    if not rubric:
        raise HTTPException(404, "评分标准不存在")
    if rubric.is_active:
        raise HTTPException(400, "不能删除当前激活的评分标准")
    db.delete(rubric)
    db.commit()
    return {"ok": True}


@router.post("/rubrics/{rubric_id}/activate", response_model=OkResponse)
def activate_rubric(rubric_id: int, current_user: User = Depends(require_teacher), db: Session = Depends(get_db)):
    from models import Rubric
    rubric = db.query(Rubric).filter(Rubric.id == rubric_id).first()
    if not rubric:
        raise HTTPException(404, "评分标准不存在")
    db.query(Rubric).update({"is_active": False})
    rubric.is_active = True
    db.commit()
    return {"ok": True}
