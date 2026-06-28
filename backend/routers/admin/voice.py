"""Admin voice config management + unified cost dashboard."""

import csv
import io
import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import require_permission
from infrastructure.asr.client import VolcASRClient
from infrastructure.llm.crypto_utils import decrypt_api_key, encrypt_api_key
from infrastructure.tts.client import VolcTTSClient
from models import ApiSecret, LLMCallLog, User, VoiceCallLog, VoiceConfig
from schemas.voice import (
    CostBreakdown,
    CostDashboardResponse,
    CostSeriesPoint,
    VoiceConfigExportResponse,
    VoiceConfigImportRequest,
    VoiceConfigResponse,
    VoiceConfigUpdateRequest,
    VoiceStatusResponse,
    VoiceUsageItem,
    VoiceUsageResponse,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/voice", tags=["语音管理"])


def _mask_api_key(vc: VoiceConfig) -> str:
    try:
        raw = decrypt_api_key(vc.api_key_enc) if vc.api_key_enc else ""
        if not raw:
            return "未设置"
        if vc.api_key_suffix and not raw.endswith(vc.api_key_suffix):
            return "***mismatch***"
    except Exception:
        return "***error***"
    if len(raw) <= 8:
        return "***...***"
    return f"{'*' * 8}{raw[-4:]}"


def _build_voice_config_response(vc: VoiceConfig | None) -> VoiceConfigResponse | None:
    if not vc:
        return None
    return VoiceConfigResponse(
        id=vc.id,
        provider=vc.provider,
        api_key_masked=_mask_api_key(vc),
        api_key_suffix=vc.api_key_suffix or "****",
        tts_resource_id=vc.tts_resource_id,
        tts_speaker=vc.tts_speaker,
        tts_model=vc.tts_model,
        tts_sample_rate=vc.tts_sample_rate,
        tts_format=vc.tts_format,
        tts_timeout=vc.tts_timeout,
        asr_resource_id=vc.asr_resource_id,
        asr_sample_rate=vc.asr_sample_rate,
        asr_endpoint_mode=vc.asr_endpoint_mode,
        monthly_budget=vc.monthly_budget,
        is_active=vc.is_active,
        created_at=vc.created_at.isoformat(),
        updated_at=vc.updated_at.isoformat(),
    )


# ── Voice Config CRUD ──


@router.get("/config", response_model=VoiceConfigResponse)
def get_config(
    current_user: Annotated[User, Depends(require_permission("llm_monitor"))],
    db: Annotated[Session, Depends(get_db)],
):
    vc = db.query(VoiceConfig).order_by(VoiceConfig.id.desc()).first()
    if not vc:
        raise HTTPException(status_code=404, detail="未找到语音配置")
    return _build_voice_config_response(vc)


@router.put("/config", response_model=VoiceConfigResponse)
def update_config(
    req: VoiceConfigUpdateRequest,
    current_user: Annotated[User, Depends(require_permission("llm_monitor"))],
    db: Annotated[Session, Depends(get_db)],
):
    vc = db.query(VoiceConfig).order_by(VoiceConfig.id.desc()).first()

    if vc:
        if req.provider:
            vc.provider = req.provider
        if req.api_key:
            vc.api_key_enc = encrypt_api_key(req.api_key)
            vc.api_key_suffix = req.api_key[-8:] if len(req.api_key) >= 8 else req.api_key
        vc.tts_resource_id = req.tts_resource_id
        vc.tts_speaker = req.tts_speaker
        vc.tts_model = req.tts_model
        vc.tts_sample_rate = req.tts_sample_rate
        vc.tts_format = req.tts_format
        vc.tts_timeout = req.tts_timeout
        vc.asr_resource_id = req.asr_resource_id
        vc.asr_sample_rate = req.asr_sample_rate
        vc.asr_endpoint_mode = req.asr_endpoint_mode
        vc.monthly_budget = req.monthly_budget
        vc.is_active = req.is_active
    else:
        api_key_enc = encrypt_api_key(req.api_key) if req.api_key else ""
        api_key_suffix = req.api_key[-8:] if req.api_key and len(req.api_key) >= 8 else (req.api_key or "")
        vc = VoiceConfig(
            provider=req.provider,
            api_key_enc=api_key_enc,
            api_key_suffix=api_key_suffix,
            tts_resource_id=req.tts_resource_id,
            tts_speaker=req.tts_speaker,
            tts_model=req.tts_model,
            tts_sample_rate=req.tts_sample_rate,
            tts_format=req.tts_format,
            tts_timeout=req.tts_timeout,
            asr_resource_id=req.asr_resource_id,
            asr_sample_rate=req.asr_sample_rate,
            asr_endpoint_mode=req.asr_endpoint_mode,
            monthly_budget=req.monthly_budget,
            is_active=req.is_active,
        )
        db.add(vc)

    db.commit()
    db.refresh(vc)
    return _build_voice_config_response(vc)


async def _do_test_tts(db: Session) -> VoiceStatusResponse:
    vc = db.query(VoiceConfig).filter(VoiceConfig.is_active == True).first()
    if not vc:
        raise HTTPException(status_code=404, detail="未找到激活的语音配置")

    try:
        api_key = decrypt_api_key(vc.api_key_enc) if vc.api_key_enc else ""
        if not api_key:
            raise HTTPException(status_code=400, detail="尚未设置 API Key")
        if vc.api_key_suffix and not api_key.endswith(vc.api_key_suffix):
            raise HTTPException(status_code=500, detail="API Key 完整性校验失败，请重新设置")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="无法解密 API Key")

    client = VolcTTSClient(api_key=api_key, resource_id=vc.tts_resource_id, timeout=vc.tts_timeout)
    try:
        ok = await client.health_check(speaker=vc.tts_speaker)
        await client.close()
        return VoiceStatusResponse(
            provider=vc.provider,
            tts_online=ok,
            asr_online=False,
            last_error=None if ok else "TTS 健康检查失败",
            last_error_at=None if ok else datetime.now(UTC).isoformat(),
        )
    except Exception as e:
        await client.close()
        return VoiceStatusResponse(
            provider=vc.provider,
            tts_online=False,
            asr_online=False,
            last_error=str(e)[:500],
            last_error_at=datetime.now(UTC).isoformat(),
        )


@router.post("/config/test-tts", response_model=VoiceStatusResponse)
async def test_tts(
    request: Request,
    current_user: Annotated[User, Depends(require_permission("llm_monitor"))],
    db: Annotated[Session, Depends(get_db)],
):
    return await _do_test_tts(db)


async def _do_test_asr(db: Session, request: Request) -> VoiceStatusResponse:
    vc = db.query(VoiceConfig).filter(VoiceConfig.is_active == True).first()
    if not vc:
        raise HTTPException(status_code=404, detail="未找到激活的语音配置")

    try:
        api_key = decrypt_api_key(vc.api_key_enc) if vc.api_key_enc else ""
    except Exception:
        api_key = ""

    if not api_key or not vc.asr_resource_id:
        return VoiceStatusResponse(
            provider=vc.provider,
            tts_online=False,
            asr_online=False,
            last_error="ASR 未配置（缺少 API Key 或 resource_id），将使用文本输入降级",
            last_error_at=datetime.now(UTC).isoformat(),
        )

    client = VolcASRClient(
        api_key=api_key,
        resource_id=vc.asr_resource_id,
        endpoint_mode=vc.asr_endpoint_mode,
        sample_rate=vc.asr_sample_rate,
    )
    try:
        ok = await client.health_check()
        return VoiceStatusResponse(
            provider=vc.provider,
            tts_online=False,
            asr_online=ok,
            last_error=None if ok else "ASR 上游建连失败",
            last_error_at=None if ok else datetime.now(UTC).isoformat(),
        )
    except Exception as e:
        return VoiceStatusResponse(
            provider=vc.provider,
            tts_online=False,
            asr_online=False,
            last_error=str(e)[:500],
            last_error_at=datetime.now(UTC).isoformat(),
        )


@router.post("/config/test-asr", response_model=VoiceStatusResponse)
async def test_asr(
    request: Request,
    current_user: Annotated[User, Depends(require_permission("llm_monitor"))],
    db: Annotated[Session, Depends(get_db)],
):
    return await _do_test_asr(db, request)


# ── Voice Usage Stats ──


def _query_voice_usage(db: Session, direction: str, since: datetime) -> VoiceUsageItem:
    base = db.query(VoiceCallLog).filter(
        VoiceCallLog.direction == direction,
        VoiceCallLog.created_at >= since,
    )
    total = base.count()
    success = base.filter(VoiceCallLog.status == "success").count()
    fallback = base.filter(VoiceCallLog.status == "fallback").count()
    error_count = base.filter(VoiceCallLog.status == "error").count()
    total_chars = (
        db.query(func.coalesce(func.sum(VoiceCallLog.text_length), 0))
        .filter(
            VoiceCallLog.direction == direction,
            VoiceCallLog.created_at >= since,
        )
        .scalar()
        or 0
    )
    total_latency = (
        db.query(func.coalesce(func.sum(VoiceCallLog.latency_ms), 0))
        .filter(
            VoiceCallLog.direction == direction,
            VoiceCallLog.created_at >= since,
        )
        .scalar()
        or 0
    )
    cost = (
        db.query(func.coalesce(func.sum(VoiceCallLog.cost_estimated), 0))
        .filter(
            VoiceCallLog.direction == direction,
            VoiceCallLog.created_at >= since,
        )
        .scalar()
        or 0
    )
    return VoiceUsageItem(
        calls_total=total,
        calls_success=success,
        calls_fallback=fallback,
        calls_error=error_count,
        total_chars=int(total_chars),
        total_latency_ms=int(total_latency),
        cost_estimated=round(float(cost), 6),
    )


@router.get("/usage", response_model=VoiceUsageResponse)
def get_voice_usage(
    current_user: Annotated[User, Depends(require_permission("llm_monitor"))],
    db: Annotated[Session, Depends(get_db)],
):
    now = datetime.now(UTC)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = today_start.replace(day=1)

    vc = db.query(VoiceConfig).filter(VoiceConfig.is_active == True).first()
    monthly_budget = vc.monthly_budget if vc else 0.0

    month_tts = _query_voice_usage(db, "tts", month_start)
    month_asr = _query_voice_usage(db, "asr", month_start)
    monthly_used = round(month_tts.cost_estimated + month_asr.cost_estimated, 6)

    return VoiceUsageResponse(
        tts_today=_query_voice_usage(db, "tts", today_start),
        asr_today=_query_voice_usage(db, "asr", today_start),
        tts_month=month_tts,
        asr_month=month_asr,
        monthly_budget=monthly_budget,
        monthly_used=monthly_used,
    )


# ── Unified Cost Dashboard ──


def _build_breakdown(
    total: int, success: int, error_count: int, avg_latency: float, total_cost: float
) -> CostBreakdown:
    return CostBreakdown(
        calls=total,
        success=success,
        error=error_count,
        latency_ms_avg=round(avg_latency or 0, 1),
        total_cost=round(total_cost or 0, 6),
    )


def _query_llm_stats(db: Session, since: datetime) -> tuple[int, int, int, float, float]:
    base = db.query(LLMCallLog).filter(LLMCallLog.created_at >= since)
    total = base.count()
    success = base.filter(LLMCallLog.status == "success").count()
    error_count = base.filter(LLMCallLog.status == "error").count()
    avg_latency = db.query(func.avg(LLMCallLog.latency_ms)).filter(LLMCallLog.created_at >= since).scalar()
    total_cost = db.query(func.sum(LLMCallLog.estimated_cost)).filter(LLMCallLog.created_at >= since).scalar()
    return total, success, error_count, float(avg_latency or 0), float(total_cost or 0)


def _query_voice_stats(db: Session, since: datetime) -> tuple[int, int, int, float, float]:
    base = db.query(VoiceCallLog).filter(VoiceCallLog.created_at >= since)
    total = base.count()
    success = base.filter(VoiceCallLog.status == "success").count()
    error_count = base.filter(VoiceCallLog.status == "error").count()
    avg_latency = db.query(func.avg(VoiceCallLog.latency_ms)).filter(VoiceCallLog.created_at >= since).scalar()
    total_cost = db.query(func.sum(VoiceCallLog.cost_estimated)).filter(VoiceCallLog.created_at >= since).scalar()
    return total, success, error_count, float(avg_latency or 0), float(total_cost or 0)


def _query_daily_series(db: Session, days: int = 30) -> list[CostSeriesPoint]:
    now = datetime.now(UTC)
    since = now - timedelta(days=days - 1)

    llm_rows = (
        db.query(
            func.date(LLMCallLog.created_at).label("date"),
            func.coalesce(func.sum(LLMCallLog.estimated_cost), 0).label("llm_cost"),
        )
        .filter(LLMCallLog.created_at >= since)
        .group_by("date")
        .all()
    )
    llm_map: dict[str, float] = {str(r[0]): float(r[1]) for r in llm_rows}

    tts_rows = (
        db.query(
            func.date(VoiceCallLog.created_at).label("date"),
            func.coalesce(func.sum(VoiceCallLog.cost_estimated).filter(VoiceCallLog.direction == "tts"), 0).label(
                "tts_cost"
            ),
        )
        .filter(VoiceCallLog.created_at >= since)
        .group_by("date")
        .all()
    )
    tts_map: dict[str, float] = {str(r[0]): float(r[1]) for r in tts_rows}

    asr_rows = (
        db.query(
            func.date(VoiceCallLog.created_at).label("date"),
            func.coalesce(func.sum(VoiceCallLog.cost_estimated).filter(VoiceCallLog.direction == "asr"), 0).label(
                "asr_cost"
            ),
        )
        .filter(VoiceCallLog.created_at >= since)
        .group_by("date")
        .all()
    )
    asr_map: dict[str, float] = {str(r[0]): float(r[1]) for r in asr_rows}

    series: list[CostSeriesPoint] = []
    for i in range(days - 1, -1, -1):
        d = now - timedelta(days=i)
        date_str = d.strftime("%Y-%m-%d")
        series.append(
            CostSeriesPoint(
                date=date_str,
                llm_cost=llm_map.get(date_str, 0.0),
                tts_cost=tts_map.get(date_str, 0.0),
                asr_cost=asr_map.get(date_str, 0.0),
            )
        )
    return series


@router.get("/costs/dashboard", response_model=CostDashboardResponse)
def get_cost_dashboard(
    current_user: Annotated[User, Depends(require_permission("llm_monitor"))],
    db: Annotated[Session, Depends(get_db)],
):
    now = datetime.now(UTC)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = today_start.replace(day=1)

    vc = db.query(VoiceConfig).filter(VoiceConfig.is_active == True).first()
    voice_budget = vc.monthly_budget if vc else 0.0

    # Sum LLM monthly_cost_limit from active ApiSecrets
    llm_budget = (
        db.query(func.coalesce(func.sum(ApiSecret.monthly_cost_limit), 0)).filter(ApiSecret.status == "active").scalar()
        or 0.0
    )
    llm_budget = round(float(llm_budget), 6)
    total_budget = round(voice_budget + llm_budget, 6)

    # Today: combined
    llm_today = _query_llm_stats(db, today_start)
    voice_today = _query_voice_stats(db, today_start)
    today_total = llm_today[0] + voice_today[0]
    today_success = llm_today[1] + voice_today[1]
    today_error = llm_today[2] + voice_today[2]
    today_latency = (
        (llm_today[3] * llm_today[0] + voice_today[3] * voice_today[0]) / today_total if today_total > 0 else 0.0
    )
    today_cost = round(llm_today[4] + voice_today[4], 6)

    # TTS / ASR breakdown today
    voice_tts_today = _query_voice_stats_direction(db, today_start, "tts")
    voice_asr_today = _query_voice_stats_direction(db, today_start, "asr")

    # This month: combined
    llm_month = _query_llm_stats(db, month_start)
    voice_month = _query_voice_stats(db, month_start)
    month_total = llm_month[0] + voice_month[0]
    month_success = llm_month[1] + voice_month[1]
    month_error = llm_month[2] + voice_month[2]
    month_latency = (
        (llm_month[3] * llm_month[0] + voice_month[3] * voice_month[0]) / month_total if month_total > 0 else 0.0
    )
    month_cost = round(llm_month[4] + voice_month[4], 6)

    # Top users (this month) — LLM costs
    top_llm_rows = (
        db.query(
            User.display_name.label("user_name"),
            User.id.label("user_id"),
            func.sum(LLMCallLog.estimated_cost).label("llm_cost"),
            func.count(LLMCallLog.id).label("llm_calls"),
        )
        .join(LLMCallLog, LLMCallLog.user_id == User.id, isouter=False)
        .filter(LLMCallLog.created_at >= month_start)
        .group_by(User.id, User.display_name)
        .all()
    )
    # Voice costs
    top_voice_rows = (
        db.query(
            User.display_name.label("user_name"),
            User.id.label("user_id"),
            func.sum(VoiceCallLog.cost_estimated).label("voice_cost"),
            func.count(VoiceCallLog.id).label("voice_calls"),
        )
        .join(VoiceCallLog, VoiceCallLog.user_id == User.id, isouter=False)
        .filter(VoiceCallLog.created_at >= month_start)
        .group_by(User.id, User.display_name)
        .all()
    )

    # Merge LLM + Voice per user
    user_costs: dict[int, dict] = {}
    for r in top_llm_rows:
        uid = r[1]
        user_costs[uid] = {
            "user_name": r[0] or "未知",
            "total_cost": float(r[2] or 0),
            "calls": int(r[3] or 0),
        }
    for r in top_voice_rows:
        uid = r[1]
        if uid in user_costs:
            user_costs[uid]["total_cost"] += float(r[2] or 0)
            user_costs[uid]["calls"] += int(r[3] or 0)
        else:
            user_costs[uid] = {
                "user_name": r[0] or "未知",
                "total_cost": float(r[2] or 0),
                "calls": int(r[3] or 0),
            }

    top_users = sorted(
        [
            {"user_name": v["user_name"], "total_cost": round(v["total_cost"], 6), "calls": v["calls"]}
            for v in user_costs.values()
        ],
        key=lambda x: x["total_cost"],
        reverse=True,
    )[:10]

    daily_series = _query_daily_series(db, 30)

    return CostDashboardResponse(
        today=_build_breakdown(today_total, today_success, today_error, today_latency, today_cost),
        this_month=_build_breakdown(month_total, month_success, month_error, month_latency, month_cost),
        llm_today=_build_breakdown(llm_today[0], llm_today[1], llm_today[2], llm_today[3], llm_today[4]),
        tts_today=_build_breakdown(
            voice_tts_today[0], voice_tts_today[1], voice_tts_today[2], voice_tts_today[3], voice_tts_today[4]
        ),
        asr_today=_build_breakdown(
            voice_asr_today[0], voice_asr_today[1], voice_asr_today[2], voice_asr_today[3], voice_asr_today[4]
        ),
        monthly_budget=total_budget,
        monthly_used=month_cost,
        llm_monthly_budget=llm_budget,
        voice_monthly_budget=voice_budget,
        daily_series=daily_series,
        top_users=top_users,
    )


def _query_voice_stats_direction(db: Session, since: datetime, direction: str) -> tuple[int, int, int, float, float]:
    base = db.query(VoiceCallLog).filter(
        VoiceCallLog.direction == direction,
        VoiceCallLog.created_at >= since,
    )
    total = base.count()
    success = base.filter(VoiceCallLog.status == "success").count()
    error_count = base.filter(VoiceCallLog.status == "error").count()
    avg_latency = (
        db.query(func.avg(VoiceCallLog.latency_ms))
        .filter(VoiceCallLog.direction == direction, VoiceCallLog.created_at >= since)
        .scalar()
    )
    total_cost = (
        db.query(func.sum(VoiceCallLog.cost_estimated))
        .filter(VoiceCallLog.direction == direction, VoiceCallLog.created_at >= since)
        .scalar()
    )
    return total, success, error_count, float(avg_latency or 0), float(total_cost or 0)


# ── Cost Export ──


def _parse_date(d: str) -> datetime:
    try:
        return datetime.strptime(d, "%Y-%m-%d").replace(tzinfo=UTC)
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail=f"无效的日期格式: {d}，请使用 YYYY-MM-DD 格式")


@router.get("/costs/export")
def export_costs(
    current_user: Annotated[User, Depends(require_permission("llm_monitor"))],
    db: Annotated[Session, Depends(get_db)],
    start_date: str = Query(default=""),
    end_date: str = Query(default=""),
    service: str = Query(default=""),
    granularity: str = Query(default="daily"),
    export_format: str = Query(default="json", alias="format"),
):
    now = datetime.now(UTC)
    since = _parse_date(start_date) if start_date else now - timedelta(days=30)
    until = (_parse_date(end_date) + timedelta(days=1)) if end_date else now

    rows: list[dict] = []

    date_group = (
        func.date_trunc("month", LLMCallLog.created_at)
        if granularity == "monthly"
        else func.date(LLMCallLog.created_at)
    )

    include_llm = not service or service == "llm"
    include_voice = not service or service in ("tts", "asr")

    if include_llm:
        llm_rows = (
            db.query(
                date_group.label("date"),
                func.coalesce(func.sum(LLMCallLog.estimated_cost), 0).label("cost"),
                func.count().label("calls"),
                func.sum(func.cast(LLMCallLog.status == "success", type_=int)).label("success"),
                func.sum(func.cast(LLMCallLog.status != "success", type_=int)).label("error"),
            )
            .filter(LLMCallLog.created_at >= since, LLMCallLog.created_at < until)
            .group_by("date")
            .order_by("date")
            .all()
        )
        for r in llm_rows:
            rows.append(
                {
                    "date": str(r[0]),
                    "service": "llm",
                    "cost": round(float(r[1] or 0), 6),
                    "calls": r[2],
                    "success": r[3] or 0,
                    "error": r[4] or 0,
                }
            )

    if include_voice:
        voice_date_group = (
            func.date_trunc("month", VoiceCallLog.created_at)
            if granularity == "monthly"
            else func.date(VoiceCallLog.created_at)
        )
        direction_filter = [service] if service in ("tts", "asr") else ["tts", "asr"]

        for direction in direction_filter:
            voice_rows = (
                db.query(
                    voice_date_group.label("date"),
                    func.coalesce(func.sum(VoiceCallLog.cost_estimated), 0).label("cost"),
                    func.count().label("calls"),
                    func.sum(func.cast(VoiceCallLog.status == "success", type_=int)).label("success"),
                    func.sum(func.cast(VoiceCallLog.status != "success", type_=int)).label("error"),
                )
                .filter(
                    VoiceCallLog.direction == direction,
                    VoiceCallLog.created_at >= since,
                    VoiceCallLog.created_at < until,
                )
                .group_by("date")
                .order_by("date")
                .all()
            )
            for r in voice_rows:
                rows.append(
                    {
                        "date": str(r[0]),
                        "service": direction,
                        "cost": round(float(r[1] or 0), 6),
                        "calls": r[2],
                        "success": r[3] or 0,
                        "error": r[4] or 0,
                    }
                )

    rows.sort(key=lambda x: x["date"])

    if export_format == "csv":
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=["date", "service", "cost", "calls", "success", "error"])
        writer.writeheader()
        writer.writerows(rows)
        csv_bytes = output.getvalue().encode("utf-8-sig")
        return StreamingResponse(
            iter([csv_bytes]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=cost_export.csv"},
        )

    return rows


# ── Voice Config Export / Import ──


@router.get("/config/export")
def export_voice_config(
    current_user: Annotated[User, Depends(require_permission("llm_monitor"))],
    db: Annotated[Session, Depends(get_db)],
):
    vc = db.query(VoiceConfig).filter(VoiceConfig.is_active == True).first()
    if not vc:
        raise HTTPException(status_code=404, detail="未找到激活的语音配置")

    payload = VoiceConfigExportResponse(
        provider=vc.provider,
        tts_resource_id=vc.tts_resource_id,
        tts_speaker=vc.tts_speaker,
        tts_model=vc.tts_model,
        tts_sample_rate=vc.tts_sample_rate,
        tts_format=vc.tts_format,
        tts_timeout=vc.tts_timeout,
        asr_resource_id=vc.asr_resource_id,
        asr_sample_rate=vc.asr_sample_rate,
        asr_endpoint_mode=vc.asr_endpoint_mode,
        monthly_budget=vc.monthly_budget,
        exported_at=datetime.now(UTC).isoformat(),
    )
    json_bytes = json.dumps(payload.model_dump(), ensure_ascii=False, indent=2).encode("utf-8")
    return Response(
        content=json_bytes,
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=voice_config_export.json"},
    )


@router.post("/config/import", response_model=VoiceConfigResponse)
def import_voice_config(
    data: VoiceConfigImportRequest,
    current_user: Annotated[User, Depends(require_permission("llm_monitor"))],
    db: Annotated[Session, Depends(get_db)],
):
    vc = db.query(VoiceConfig).filter(VoiceConfig.is_active == True).first()

    api_key_enc = encrypt_api_key(data.api_key)
    api_key_suffix = data.api_key[-8:] if len(data.api_key) >= 8 else data.api_key

    if vc:
        vc.provider = data.provider
        vc.api_key_enc = api_key_enc
        vc.api_key_suffix = api_key_suffix
        vc.tts_resource_id = data.tts_resource_id
        vc.tts_speaker = data.tts_speaker
        vc.tts_model = data.tts_model
        vc.tts_sample_rate = data.tts_sample_rate
        vc.tts_format = data.tts_format
        vc.tts_timeout = data.tts_timeout
        vc.asr_resource_id = data.asr_resource_id
        vc.asr_sample_rate = data.asr_sample_rate
        vc.asr_endpoint_mode = data.asr_endpoint_mode
        vc.monthly_budget = data.monthly_budget
    else:
        vc = VoiceConfig(
            provider=data.provider,
            api_key_enc=api_key_enc,
            api_key_suffix=api_key_suffix,
            tts_resource_id=data.tts_resource_id,
            tts_speaker=data.tts_speaker,
            tts_model=data.tts_model,
            tts_sample_rate=data.tts_sample_rate,
            tts_format=data.tts_format,
            tts_timeout=data.tts_timeout,
            asr_resource_id=data.asr_resource_id,
            asr_sample_rate=data.asr_sample_rate,
            asr_endpoint_mode=data.asr_endpoint_mode,
            monthly_budget=data.monthly_budget,
            is_active=True,
        )
        db.add(vc)

    db.commit()
    db.refresh(vc)
    return _build_voice_config_response(vc)
