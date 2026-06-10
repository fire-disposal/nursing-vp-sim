import logging
from datetime import UTC, datetime, timedelta

from core.datetime_utils import parse_iso_datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Integer as SAInteger
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import require_permission
from infrastructure.export import Column, buffered_response
from models import ApiProvider, Case as CaseModel, LLMCallLog, TrainingRecord, User
from schemas import (
    LLMCallLogItem,
    LLMStatsResponse,
    PaginatedResponse,
)

log = logging.getLogger(__name__)

router = APIRouter()


def _build_llm_stats(db: Session, since: datetime):
    base = db.query(LLMCallLog).filter(LLMCallLog.created_at >= since, LLMCallLog.created_at < datetime.now(UTC))
    total = base.count()
    if total == 0:
        return {"count": 0, "success_rate": 0, "avg_latency_ms": 0, "total_cost": 0}
    success_count = base.filter(LLMCallLog.status == "success").count()
    avg_latency = (
        db.query(func.avg(LLMCallLog.latency_ms))
        .filter(LLMCallLog.created_at >= since, LLMCallLog.created_at < datetime.now(UTC))
        .scalar()
        or 0
    )
    total_cost = (
        db.query(func.sum(LLMCallLog.estimated_cost))
        .filter(LLMCallLog.created_at >= since, LLMCallLog.created_at < datetime.now(UTC))
        .scalar()
        or 0
    )
    return {
        "count": total,
        "success_rate": round(success_count / total * 100, 1),
        "avg_latency_ms": round(avg_latency, 0),
        "total_cost": round(total_cost, 4),
    }


@router.get("/llm-stats", response_model=LLMStatsResponse)
def get_llm_stats(current_user: Annotated[User, Depends(require_permission("llm_monitor"))], db: Annotated[Session, Depends(get_db)]):
    now = datetime.now(UTC)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=7)
    month_start = today_start - timedelta(days=30)

    today_stats = _build_llm_stats(db, today_start)
    week_stats = _build_llm_stats(db, week_start)
    month_start_cal = today_start.replace(day=1)
    month_stats = _build_llm_stats(db, month_start_cal)

    rows = (
        db.query(
            LLMCallLog.purpose,
            func.count().label("count"),
            func.avg(LLMCallLog.latency_ms).label("avg_latency"),
            func.sum(func.cast(LLMCallLog.status != "success", type_=SAInteger)).label("error_count"),
        )
        .filter(LLMCallLog.created_at >= week_start, LLMCallLog.created_at < now)
        .group_by(LLMCallLog.purpose)
        .all()
    )
    by_purpose = [
        {"purpose": r[0], "count": r[1], "avg_latency_ms": round(r[2] or 0, 0), "error_count": r[3]} for r in rows
    ]

    daily_rows = (
        db.query(
            func.date(LLMCallLog.created_at).label("date"),
            func.count().label("count"),
            func.sum(func.cast(LLMCallLog.status == "success", type_=SAInteger)).label("success_count"),
            func.sum(func.cast(LLMCallLog.status != "success", type_=SAInteger)).label("fail_count"),
            func.sum(LLMCallLog.estimated_cost).label("total_cost"),
        )
        .filter(LLMCallLog.created_at >= month_start, LLMCallLog.created_at < now)
        .group_by("date")
        .order_by("date")
        .all()
    )
    daily = [
        {
            "date": str(r[0]),
            "count": r[1],
            "success_count": r[2] or 0,
            "fail_count": r[3] or 0,
            "total_cost": round(r[4] or 0, 4),
        }
        for r in daily_rows
    ]

    provider_rows = (
        db.query(
            LLMCallLog.provider_name,
            func.count().label("count"),
            func.coalesce(func.sum(LLMCallLog.estimated_cost), 0).label("total_cost"),
            func.sum(func.cast(LLMCallLog.status != "success", type_=SAInteger)).label("error_count"),
        )
        .filter(LLMCallLog.created_at >= week_start, LLMCallLog.created_at < now)
        .group_by(LLMCallLog.provider_name)
        .all()
    )
    by_provider = [
        {"provider": r[0] or "unknown", "count": r[1], "total_cost": round(float(r[2]), 4), "error_count": r[3] or 0}
        for r in provider_rows
    ]

    return LLMStatsResponse(
        today=today_stats,
        week=week_stats,
        month=month_stats,
        by_purpose=by_purpose,
        by_provider=by_provider,
        daily=daily,
    )


@router.get("/llm-logs", response_model=PaginatedResponse[LLMCallLogItem])
def get_llm_logs(
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    purpose: str | None = None,
    status: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    aggregate_patient_chat: bool = True,
    current_user: User = Depends(require_permission("llm_monitor")),
    db: Session = Depends(get_db),
):
    do_agg = aggregate_patient_chat and (purpose is None or purpose == "patient_chat")
    need_raw = (not aggregate_patient_chat) or (purpose != "patient_chat")

    agg_count = 0
    raw_count = 0
    agg_rows = []
    raw_rows = []

    if do_agg:
        agg_q = (
            db.query(
                LLMCallLog.record_id.label("record_id"),
                func.max(LLMCallLog.id).label("id"),
                func.max(LLMCallLog.user_id).label("user_id"),
                func.max(LLMCallLog.case_id).label("case_id"),
                func.count().label("call_count"),
                func.avg(LLMCallLog.latency_ms).label("latency_ms"),
                func.sum(LLMCallLog.prompt_tokens).label("prompt_tokens"),
                func.sum(LLMCallLog.completion_tokens).label("completion_tokens"),
                func.sum(LLMCallLog.total_tokens).label("total_tokens"),
                func.max(LLMCallLog.token_estimated).label("token_estimated"),
                func.sum(LLMCallLog.estimated_cost).label("estimated_cost"),
                func.sum(func.cast(LLMCallLog.status != "success", type_=SAInteger)).label("error_count"),
                func.min(LLMCallLog.created_at).label("first_called_at"),
                func.max(LLMCallLog.created_at).label("created_at"),
                User.display_name.label("student_name"),
                CaseModel.name.label("case_name"),
                ApiProvider.display_name.label("provider_display_name"),
            )
            .join(TrainingRecord, LLMCallLog.record_id == TrainingRecord.id, isouter=True)
            .join(User, TrainingRecord.user_id == User.id, isouter=True)
            .join(CaseModel, TrainingRecord.case_id == CaseModel.id, isouter=True)
            .join(ApiProvider, LLMCallLog.provider_name == ApiProvider.name, isouter=True)
            .filter(
                LLMCallLog.purpose == "patient_chat",
                LLMCallLog.record_id.isnot(None),
            )
        )

        if date_from:
            agg_q = agg_q.filter(LLMCallLog.created_at >= parse_iso_datetime(date_from))
        if date_to:
            agg_q = agg_q.filter(LLMCallLog.created_at < parse_iso_datetime(date_to))

        agg_q = agg_q.group_by(LLMCallLog.record_id, User.display_name, CaseModel.name, ApiProvider.display_name)

        if status == "success":
            agg_q = agg_q.having(func.sum(func.cast(LLMCallLog.status != "success", type_=SAInteger)) == 0)
        elif status == "failed":
            agg_q = agg_q.having(func.sum(func.cast(LLMCallLog.status != "success", type_=SAInteger)) > 0)

        agg_count = agg_q.order_by(None).count()
        agg_rows = agg_q.order_by(func.max(LLMCallLog.created_at).desc()).offset(offset).limit(limit).all()

    if need_raw:
        q = db.query(LLMCallLog)
        if aggregate_patient_chat and purpose is None:
            q = q.filter(LLMCallLog.purpose != "patient_chat")
        elif purpose:
            q = q.filter(LLMCallLog.purpose == purpose)
        if status:
            q = q.filter(LLMCallLog.status == status)
        if date_from:
            q = q.filter(LLMCallLog.created_at >= parse_iso_datetime(date_from))
        if date_to:
            q = q.filter(LLMCallLog.created_at < parse_iso_datetime(date_to))

        raw_count = q.order_by(None).count()

        remaining_offset = max(0, offset - agg_count)
        remaining_limit = max(0, limit - len(agg_rows))
        if remaining_limit > 0:
            raw_rows = q.order_by(LLMCallLog.created_at.desc()).offset(remaining_offset).limit(remaining_limit).all()

    total = agg_count + raw_count

    all_items = []

    for r in agg_rows:
        avg_lat = round(r.latency_ms) if r.latency_ms is not None else None
        all_items.append(
            {
                "id": r.id,
                "user_id": r.user_id,
                "record_id": r.record_id,
                "case_id": r.case_id,
                "purpose": "patient_chat",
                "provider_name": r.provider_display_name or "deepseek",
                "model": "",
                "temperature": None,
                "max_tokens": None,
                "prompt_tokens": r.prompt_tokens,
                "completion_tokens": r.completion_tokens,
                "total_tokens": r.total_tokens,
                "token_estimated": 1 if r.token_estimated else 0,
                "estimated_cost": round(r.estimated_cost, 6) if r.estimated_cost is not None else None,
                "cost_currency": None,
                "latency_ms": avg_lat,
                "status": "success" if (r.error_count or 0) == 0 else "failed",
                "error_type": None,
                "error_message": None,
                "request_chars": None,
                "response_chars": None,
                "created_at": r.created_at,
                "call_count": r.call_count,
                "avg_latency_ms": avg_lat,
                "error_count": r.error_count or 0,
                "first_called_at": r.first_called_at,
                "last_called_at": r.created_at,
                "student_name": r.student_name,
                "case_name": r.case_name,
                "is_aggregated": True,
            }
        )

    all_items.extend(raw_rows)

    def _get_ts(item):
        if isinstance(item, dict):
            return item["created_at"]
        return item.created_at

    all_items.sort(key=_get_ts, reverse=True)

    items = []
    for it in all_items:
        if isinstance(it, dict):
            items.append(LLMCallLogItem.model_validate(it))
        else:
            items.append(LLMCallLogItem.model_validate(it))

    return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)


@router.get("/llm-logs/export")
def export_llm_logs_csv(
    date_from: str | None = None,
    date_to: str | None = None,
    current_user: User = Depends(require_permission("llm_monitor")),
    db: Session = Depends(get_db),
):
    q = db.query(LLMCallLog)
    if date_from:
        q = q.filter(LLMCallLog.created_at >= parse_iso_datetime(date_from))
    if date_to:
        q = q.filter(LLMCallLog.created_at < parse_iso_datetime(date_to))
    entries = q.order_by(LLMCallLog.created_at.desc()).limit(50000).all()

    columns = [
        Column("ID", lambda e: str(e.id)),
        Column("时间", lambda e: e.created_at.isoformat() if e.created_at else ""),
        Column("用户ID", lambda e: str(e.user_id) if e.user_id else ""),
        Column("训练记录ID", lambda e: str(e.record_id) if e.record_id else ""),
        Column("病例ID", lambda e: str(e.case_id) if e.case_id else ""),
        Column("用途", lambda e: e.purpose or ""),
        Column("Provider", lambda e: getattr(e, "provider_name", "") or ""),
        Column("模型", lambda e: e.model or ""),
        Column("状态", lambda e: e.status or ""),
        Column("延迟(ms)", lambda e: str(e.latency_ms) if e.latency_ms else ""),
        Column("PromptTokens", lambda e: str(e.prompt_tokens) if e.prompt_tokens else ""),
        Column("CompletionTokens", lambda e: str(e.completion_tokens) if e.completion_tokens else ""),
        Column("TotalTokens", lambda e: str(e.total_tokens) if e.total_tokens else ""),
        Column("估算标记", lambda e: "是" if e.token_estimated else "否"),
        Column("预估费用", lambda e: str(e.estimated_cost) if e.estimated_cost else ""),
        Column("错误类型", lambda e: e.error_type or ""),
        Column("错误信息", lambda e: (e.error_message or "")[:200]),
        Column("请求字符数", lambda e: str(e.request_chars) if e.request_chars else ""),
        Column("响应字符数", lambda e: str(e.response_chars) if e.response_chars else ""),
    ]
    ts = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    return buffered_response(entries, columns, f"llm_logs_{ts}.csv")


@router.get("/llm-logs/{log_id}", response_model=LLMCallLogItem)
def get_llm_log_detail(
    log_id: int,
    current_user: Annotated[User, Depends(require_permission("llm_monitor"))],
    db: Annotated[Session, Depends(get_db)],
):
    entry = db.query(LLMCallLog).filter(LLMCallLog.id == log_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="日志不存在")
    return entry
