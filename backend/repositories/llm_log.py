"""Repository for LLM call log queries."""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Integer as SAInteger
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.datetime_utils import parse_iso_datetime
from models import Case, LLMCallLog, TrainingRecord, User


class LLMCallLogRepository:
    def __init__(self, db: Session):
        self.db = db

    def count_since(self, since: datetime) -> int:
        return (
            self.db.query(LLMCallLog)
            .filter(LLMCallLog.created_at >= since, LLMCallLog.created_at < datetime.now(UTC))
            .count()
        )

    def success_count_since(self, since: datetime) -> int:
        return (
            self.db.query(LLMCallLog)
            .filter(
                LLMCallLog.created_at >= since,
                LLMCallLog.created_at < datetime.now(UTC),
                LLMCallLog.status == "success",
            )
            .count()
        )

    def avg_latency_since(self, since: datetime) -> float:
        return (
            self.db.query(func.avg(LLMCallLog.latency_ms))
            .filter(LLMCallLog.created_at >= since, LLMCallLog.created_at < datetime.now(UTC))
            .scalar()
            or 0
        )

    def total_cost_since(self, since: datetime) -> float:
        return (
            self.db.query(func.sum(LLMCallLog.estimated_cost))
            .filter(LLMCallLog.created_at >= since, LLMCallLog.created_at < datetime.now(UTC))
            .scalar()
            or 0
        )

    def stats_by_purpose(self, since: datetime, now: datetime) -> list[Any]:
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

    def daily_stats(self, since: datetime, now: datetime) -> list[Any]:
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

    def stats_by_provider(self, since: datetime, now: datetime) -> list[Any]:
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

    def aggregated_logs(
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

    def raw_logs(
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

    def get_by_id(self, log_id: int) -> LLMCallLog | None:
        return self.db.query(LLMCallLog).filter(LLMCallLog.id == log_id).first()

    def export_query(self, date_from: str | None, date_to: str | None, limit: int = 50000) -> list[LLMCallLog]:
        q = self.db.query(LLMCallLog)
        if date_from:
            q = q.filter(LLMCallLog.created_at >= parse_iso_datetime(date_from))
        if date_to:
            q = q.filter(LLMCallLog.created_at < parse_iso_datetime(date_to))
        return q.order_by(LLMCallLog.created_at.desc()).limit(limit).all()
