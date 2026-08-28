"""LLM Monitor — router + service."""

import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import Integer as SAInteger
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from core.datetime_utils import parse_iso_datetime
from core.deps import DbSession
from core.exceptions import NotFoundError
from core.security import require_permission
from infra.exporter import ColumnDef, export_response
from models import Case, LLMCallLog, TrainingRecord, User
from schemas import LLMCallLogItem, LLMStatsResponse, PaginatedResponse

log = logging.getLogger(__name__)

EXCEL_EXPORT_ROW_LIMIT = 10000


class LLMMonitorService:
    def __init__(self, db: Session):
        self.db = db

    # --- inlined from LLMCallLogRepository ---
    def _llm_count_since(self, since: datetime) -> int:
        return (
            self.db.query(LLMCallLog)
            .filter(LLMCallLog.created_at >= since, LLMCallLog.created_at < datetime.now(UTC))
            .count()
        )

    def _llm_success_count_since(self, since: datetime) -> int:
        return (
            self.db.query(LLMCallLog)
            .filter(
                LLMCallLog.created_at >= since,
                LLMCallLog.created_at < datetime.now(UTC),
                LLMCallLog.status == "success",
            )
            .count()
        )

    def _llm_avg_latency_since(self, since: datetime) -> float:
        return (
            self.db.query(func.avg(LLMCallLog.latency_ms))
            .filter(LLMCallLog.created_at >= since, LLMCallLog.created_at < datetime.now(UTC))
            .scalar()
            or 0
        )

    def _llm_total_cost_since(self, since: datetime) -> float:
        return (
            self.db.query(func.sum(LLMCallLog.estimated_cost))
            .filter(
                LLMCallLog.created_at >= since,
                LLMCallLog.created_at < datetime.now(UTC),
                LLMCallLog.status == "success",
            )
            .scalar()
            or 0
        )

    def _llm_stats_by_purpose(self, since: datetime, now: datetime) -> list[Any]:
        return (
            self.db.query(
                LLMCallLog.purpose,
                func.count().label("count"),
                func.avg(LLMCallLog.latency_ms).label("avg_latency"),
                func.sum(func.cast(LLMCallLog.status != "success", type_=SAInteger)).label("error_count"),
            )
            .filter(LLMCallLog.created_at >= since, LLMCallLog.created_at < now)
            .group_by(LLMCallLog.purpose)
            .all()
        )

    def _llm_daily_stats(self, since: datetime, now: datetime) -> list[Any]:
        return (
            self.db.query(
                func.date(LLMCallLog.created_at).label("date"),
                func.count().label("count"),
                func.sum(func.cast(LLMCallLog.status == "success", type_=SAInteger)).label("success_count"),
                func.sum(func.cast(LLMCallLog.status != "success", type_=SAInteger)).label("fail_count"),
                func.sum(LLMCallLog.estimated_cost).label("total_cost"),
            )
            .filter(LLMCallLog.created_at >= since, LLMCallLog.created_at < now)
            .group_by("date")
            .order_by("date")
            .all()
        )

    def _llm_stats_by_provider(self, since: datetime, now: datetime) -> list[Any]:
        return (
            self.db.query(
                LLMCallLog.provider_name,
                func.count().label("count"),
                func.coalesce(func.sum(LLMCallLog.estimated_cost), 0).label("total_cost"),
                func.sum(func.cast(LLMCallLog.status != "success", type_=SAInteger)).label("error_count"),
            )
            .filter(LLMCallLog.created_at >= since, LLMCallLog.created_at < now)
            .group_by(LLMCallLog.provider_name)
            .all()
        )

    def _llm_aggregated_logs(
        self,
        record_id: int | None,
        date_from: str | None,
        date_to: str | None,
        status: str | None,
        offset: int,
        limit: int,
    ) -> tuple[list[Any], int]:
        q = (
            self.db.query(
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
                Case.name.label("case_name"),
                LLMCallLog.provider_name.label("provider_display_name"),
            )
            .join(TrainingRecord, LLMCallLog.record_id == TrainingRecord.id, isouter=True)
            .join(User, TrainingRecord.user_id == User.id, isouter=True)
            .join(Case, TrainingRecord.case_id == Case.id, isouter=True)
            .filter(LLMCallLog.purpose == "patient_chat", LLMCallLog.record_id.isnot(None))
        )
        if record_id is not None:
            q = q.filter(LLMCallLog.record_id == record_id)
        if date_from:
            q = q.filter(LLMCallLog.created_at >= parse_iso_datetime(date_from))
        if date_to:
            q = q.filter(LLMCallLog.created_at < parse_iso_datetime(date_to))
        q = q.group_by(LLMCallLog.record_id, User.display_name, Case.name, LLMCallLog.provider_name)
        if status == "success":
            q = q.having(func.sum(func.cast(LLMCallLog.status != "success", type_=SAInteger)) == 0)
        elif status == "failed":
            q = q.having(func.sum(func.cast(LLMCallLog.status != "success", type_=SAInteger)) > 0)
        total = q.order_by(None).count()
        rows = q.order_by(func.max(LLMCallLog.created_at).desc()).offset(offset).limit(limit).all()
        return rows, total

    def _llm_raw_logs(
        self,
        purpose: str | None,
        record_id: int | None,
        status: str | None,
        date_from: str | None,
        date_to: str | None,
        offset: int,
        limit: int,
        exclude_purpose: str | None = None,
    ) -> tuple[list[LLMCallLog], int]:
        q = self.db.query(LLMCallLog)
        if record_id is not None:
            q = q.filter(LLMCallLog.record_id == record_id)
        if purpose:
            q = q.filter(LLMCallLog.purpose == purpose)
        if exclude_purpose:
            q = q.filter(LLMCallLog.purpose != exclude_purpose)
        if status:
            q = q.filter(LLMCallLog.status == status)
        if date_from:
            q = q.filter(LLMCallLog.created_at >= parse_iso_datetime(date_from))
        if date_to:
            q = q.filter(LLMCallLog.created_at < parse_iso_datetime(date_to))
        total = q.order_by(None).count()
        rows = q.order_by(LLMCallLog.created_at.desc()).offset(offset).limit(limit).all()
        return rows, total

    def _llm_get_by_id(self, log_id: int) -> LLMCallLog | None:
        return self.db.query(LLMCallLog).filter(LLMCallLog.id == log_id).first()

    def _llm_export_query(self, date_from: str | None, date_to: str | None, limit: int = 50000) -> list[LLMCallLog]:
        q = self.db.query(LLMCallLog)
        if date_from:
            q = q.filter(LLMCallLog.created_at >= parse_iso_datetime(date_from))
        if date_to:
            q = q.filter(LLMCallLog.created_at < parse_iso_datetime(date_to))
        return q.order_by(LLMCallLog.created_at.desc()).limit(limit).all()

    def _build_stats(self, since: datetime):
        total = self._llm_count_since(since)
        if total == 0:
            return {"count": 0, "success_rate": 0, "avg_latency_ms": 0, "total_cost": 0}
        success_count = self._llm_success_count_since(since)
        avg_latency = self._llm_avg_latency_since(since)
        total_cost = self._llm_total_cost_since(since)
        return {
            "count": total,
            "success_rate": round(success_count / total * 100, 1),
            "avg_latency_ms": round(avg_latency, 0),
            "total_cost": round(total_cost, 4),
        }

    def get_llm_stats(self) -> LLMStatsResponse:
        now = datetime.now(UTC)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_start = today_start - timedelta(days=7)
        month_start = today_start - timedelta(days=30)

        today_stats = self._build_stats(today_start)
        week_stats = self._build_stats(week_start)
        month_start_cal = today_start.replace(day=1)
        month_stats = self._build_stats(month_start_cal)

        rows = self._llm_stats_by_purpose(week_start, now)
        by_purpose = [
            {"purpose": r[0], "count": r[1], "avg_latency_ms": round(r[2] or 0, 0), "error_count": r[3]} for r in rows
        ]

        daily_rows = self._llm_daily_stats(month_start, now)
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

        provider_rows = self._llm_stats_by_provider(week_start, now)
        by_provider = [
            {
                "provider": r[0] or "unknown",
                "count": r[1],
                "total_cost": round(float(r[2]), 4),
                "error_count": r[3] or 0,
            }
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

    def get_llm_logs(
        self,
        offset: int = 0,
        limit: int = 50,
        purpose: str | None = None,
        status: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        record_id: int | None = None,
        aggregate_patient_chat: bool = True,
    ) -> PaginatedResponse[LLMCallLogItem]:
        do_agg = aggregate_patient_chat and (purpose is None or purpose == "patient_chat")
        need_raw = (not aggregate_patient_chat) or (purpose != "patient_chat")

        agg_count = 0
        raw_count = 0
        agg_rows = []
        raw_rows = []

        if do_agg:
            agg_rows, agg_count = self._llm_aggregated_logs(
                record_id=record_id,
                date_from=date_from,
                date_to=date_to,
                status=status,
                offset=offset,
                limit=limit,
            )

        if need_raw:
            raw_purpose = purpose
            exclude_purpose = None
            if aggregate_patient_chat and purpose is None:
                raw_purpose = None
                exclude_purpose = "patient_chat"

            remaining_offset = max(0, offset - agg_count)
            remaining_limit = max(0, limit - len(agg_rows))

            raw_rows, raw_count = self._llm_raw_logs(
                purpose=raw_purpose,
                record_id=record_id,
                status=status,
                date_from=date_from,
                date_to=date_to,
                offset=remaining_offset,
                limit=remaining_limit,
                exclude_purpose=exclude_purpose,
            )

        total = agg_count + raw_count

        all_items: list[dict | LLMCallLog] = []

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

        items = [LLMCallLogItem.model_validate(it) for it in all_items]

        return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)

    def get_llm_log_detail(self, log_id: int) -> LLMCallLog:
        entry = self._llm_get_by_id(log_id)
        if not entry:
            raise NotFoundError("日志不存在")
        return entry

    def export_llm_logs(
        self, fmt: str | None = None, date_from: str | None = None, date_to: str | None = None
    ) -> Response:
        file_format = fmt or "csv"
        entries = self._llm_export_query(date_from=date_from, date_to=date_to)

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
        return export_response(entries, columns, f"llm_logs_{ts}", "LLM日志", file_format)

    def export_records(self, fmt: str | None = None) -> Response:
        file_format = fmt or "xlsx"
        query = (
            self.db.query(TrainingRecord)
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
            ColumnDef("总分", value=lambda r: r.score.effective_total if r.score else None),
            ColumnDef("开始时间", value=lambda r: str(r.start_time) if r.start_time else ""),
            ColumnDef("结束时间", value=lambda r: str(r.end_time) if r.end_time else ""),
        ]
        filename = f"训练记录导出_{datetime.now(UTC).strftime('%Y%m%d_%H%M')}"
        return export_response(records, columns, filename, "训练记录", file_format)


router = APIRouter()


@router.get("/llm-stats", response_model=LLMStatsResponse)
def get_llm_stats(
    db: DbSession,
    current_user: Annotated[User, Depends(require_permission("llm_monitor"))],
):
    svc = LLMMonitorService(db)
    return svc.get_llm_stats()


@router.get("/llm-logs", response_model=PaginatedResponse[LLMCallLogItem])
def get_llm_logs(
    db: DbSession,
    current_user: User = Depends(require_permission("llm_monitor")),
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    purpose: str | None = None,
    status: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    record_id: int | None = None,
    aggregate_patient_chat: bool = True,
):
    svc = LLMMonitorService(db)
    return svc.get_llm_logs(
        offset=offset,
        limit=limit,
        purpose=purpose,
        status=status,
        date_from=date_from,
        date_to=date_to,
        record_id=record_id,
        aggregate_patient_chat=aggregate_patient_chat,
    )


@router.post("/llm-logs/export")
def export_llm_logs_csv(
    db: DbSession,
    current_user: User = Depends(require_permission("llm_monitor")),
    format: str = Query("csv", pattern="^(csv|xlsx)$"),
    date_from: str | None = None,
    date_to: str | None = None,
):
    svc = LLMMonitorService(db)
    return svc.export_llm_logs(fmt=format, date_from=date_from, date_to=date_to)


@router.get("/llm-logs/{log_id}", response_model=LLMCallLogItem)
def get_llm_log_detail(
    log_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_permission("llm_monitor"))],
):
    svc = LLMMonitorService(db)
    return svc.get_llm_log_detail(log_id)


@router.post("/records/export")
def export_records_excel(
    db: DbSession,
    current_user: Annotated[User, Depends(require_permission("export_data"))],
    format: str = Query("xlsx", pattern="^(csv|xlsx)$"),
):
    svc = LLMMonitorService(db)
    return svc.export_records(fmt=format)
