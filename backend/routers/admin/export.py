import io
import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import Integer as SAInteger
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from core.database import get_db
from core.datetime_utils import parse_iso_datetime
from core.security import require_permission
from infrastructure.exporter import ColumnDef, CSVExporter, XLSXExporter
from models import Case as CaseModel
from models import LLMCallLog, TrainingRecord, User
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
def get_llm_stats(
    current_user: Annotated[User, Depends(require_permission("llm_monitor"))], db: Annotated[Session, Depends(get_db)]
):
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
    record_id: int | None = None,
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
                LLMCallLog.provider_name.label("provider_display_name"),
            )
            .join(TrainingRecord, LLMCallLog.record_id == TrainingRecord.id, isouter=True)
            .join(User, TrainingRecord.user_id == User.id, isouter=True)
            .join(CaseModel, TrainingRecord.case_id == CaseModel.id, isouter=True)
            .filter(
                LLMCallLog.purpose == "patient_chat",
                LLMCallLog.record_id.isnot(None),
            )
        )
        if record_id is not None:
            agg_q = agg_q.filter(LLMCallLog.record_id == record_id)

        if date_from:
            agg_q = agg_q.filter(LLMCallLog.created_at >= parse_iso_datetime(date_from))
        if date_to:
            agg_q = agg_q.filter(LLMCallLog.created_at < parse_iso_datetime(date_to))

        agg_q = agg_q.group_by(LLMCallLog.record_id, User.display_name, CaseModel.name, LLMCallLog.provider_name)

        if status == "success":
            agg_q = agg_q.having(func.sum(func.cast(LLMCallLog.status != "success", type_=SAInteger)) == 0)
        elif status == "failed":
            agg_q = agg_q.having(func.sum(func.cast(LLMCallLog.status != "success", type_=SAInteger)) > 0)

        agg_count = agg_q.order_by(None).count()
        agg_rows = agg_q.order_by(func.max(LLMCallLog.created_at).desc()).offset(offset).limit(limit).all()

    if need_raw:
        q = db.query(LLMCallLog)
        if record_id is not None:
            q = q.filter(LLMCallLog.record_id == record_id)
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
        ColumnDef("ID", key="id", fmt=str),
        ColumnDef("时间", value=lambda e: e.created_at.isoformat() if e.created_at else ""),
        ColumnDef("用户ID", key="user_id", fmt=lambda v: str(v) if v else ""),
        ColumnDef("训练记录ID", key="record_id", fmt=lambda v: str(v) if v else ""),
        ColumnDef("病例ID", key="case_id", fmt=lambda v: str(v) if v else ""),
        ColumnDef("用途", key="purpose"),
        ColumnDef("Provider", key="provider_name"),
        ColumnDef("模型", key="model"),
        ColumnDef("状态", key="status"),
        ColumnDef("延迟(ms)", key="latency_ms", fmt=lambda v: str(v) if v else ""),
        ColumnDef("PromptTokens", key="prompt_tokens", fmt=lambda v: str(v) if v else ""),
        ColumnDef("CompletionTokens", key="completion_tokens", fmt=lambda v: str(v) if v else ""),
        ColumnDef("TotalTokens", key="total_tokens", fmt=lambda v: str(v) if v else ""),
        ColumnDef("估算标记", value=lambda e: "是" if e.token_estimated else "否"),
        ColumnDef("预估费用", key="estimated_cost", fmt=lambda v: str(v) if v else ""),
        ColumnDef("错误类型", key="error_type"),
        ColumnDef("错误信息", value=lambda e: (e.error_message or "")[:200]),
        ColumnDef("请求字符数", key="request_chars", fmt=lambda v: str(v) if v else ""),
        ColumnDef("响应字符数", key="response_chars", fmt=lambda v: str(v) if v else ""),
    ]
    ts = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    content = CSVExporter().export(entries, columns, "LLM日志")
    return Response(content=content, media_type="text/csv; charset=utf-8-sig", headers={"Content-Disposition": f"attachment; filename*=UTF-8''llm_logs_{ts}.csv"})


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


EXCEL_EXPORT_ROW_LIMIT = 10000


@router.post("/records/excel")
def export_records_excel(
    current_user: Annotated[User, Depends(require_permission("export_data"))],
    db: Annotated[Session, Depends(get_db)],
):
    query = (
        db.query(TrainingRecord)
        .join(User, TrainingRecord.user_id == User.id)
        .options(
            selectinload(TrainingRecord.user), selectinload(TrainingRecord.case), selectinload(TrainingRecord.score)
        )
        .order_by(TrainingRecord.start_time.desc())
        .limit(EXCEL_EXPORT_ROW_LIMIT)
        .yield_per(100)
    )
    records = list(query)

    columns = [
        ColumnDef("记录ID", key="id", fmt=str),
        ColumnDef("学生", value=lambda r: r.user.display_name if r.user else ""),
        ColumnDef("病例", value=lambda r: r.case.name if r.case else ""),
        ColumnDef("状态", key="status"),
        ColumnDef("评分状态", key="scoring_status"),
        ColumnDef("总分", value=lambda r: r.score.total_score if r.score else None),
        ColumnDef("开始时间", value=lambda r: str(r.start_time) if r.start_time else ""),
        ColumnDef("结束时间", value=lambda r: str(r.end_time) if r.end_time else ""),
    ]
    filename = f"训练记录导出_{datetime.now(UTC).strftime('%Y%m%d_%H%M')}.xlsx"
    content = XLSXExporter().export(records, columns, "训练记录")
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
