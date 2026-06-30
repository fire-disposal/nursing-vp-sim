"""Repository for voice call log queries."""

from datetime import datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import VoiceCallLog


class VoiceCallLogRepository:
    def __init__(self, db: Session):
        self.db = db

    def count_direction_since(self, direction: str, since: datetime) -> int:
        return (
            self.db.query(VoiceCallLog)
            .filter(VoiceCallLog.direction == direction, VoiceCallLog.created_at >= since)
            .count()
        )

    def count_status_since(self, direction: str, status: str, since: datetime) -> int:
        return (
            self.db.query(VoiceCallLog)
            .filter(
                VoiceCallLog.direction == direction, VoiceCallLog.created_at >= since, VoiceCallLog.status == status
            )
            .count()
        )

    def sum_field_since(self, field: Any, direction: str, since: datetime):
        return (
            self.db.query(func.coalesce(func.sum(field), 0))
            .filter(VoiceCallLog.direction == direction, VoiceCallLog.created_at >= since)
            .scalar()
            or 0
        )

    def count_since(self, since: datetime) -> int:
        return self.db.query(VoiceCallLog).filter(VoiceCallLog.created_at >= since).count()

    def status_count_since(self, status: str, since: datetime) -> int:
        return (
            self.db.query(VoiceCallLog).filter(VoiceCallLog.created_at >= since, VoiceCallLog.status == status).count()
        )

    def avg_field_since(self, field: Any, since: datetime) -> float:
        return self.db.query(func.avg(field)).filter(VoiceCallLog.created_at >= since).scalar() or 0.0

    def sum_field_all_since(self, field: Any, since: datetime) -> float:
        return self.db.query(func.coalesce(func.sum(field), 0)).filter(VoiceCallLog.created_at >= since).scalar() or 0.0

    def avg_field_direction_since(self, field: Any, direction: str, since: datetime) -> float:
        return float(
            self.db.query(func.avg(field))
            .filter(VoiceCallLog.direction == direction, VoiceCallLog.created_at >= since)
            .scalar()
            or 0.0
        )

    def cost_series(self, since: datetime, now: datetime) -> list[Any]:
        return (
            self.db.query(
                func.date(VoiceCallLog.created_at).label("date"),
                func.sum(func.cast(VoiceCallLog.direction == "tts", type_=func.Integer)).label("tts_count"),
                func.sum(func.cast(VoiceCallLog.direction == "asr", type_=func.Integer)).label("asr_count"),
                func.sum(VoiceCallLog.cost_estimated).label("total_cost"),
            )
            .filter(VoiceCallLog.created_at >= since, VoiceCallLog.created_at < now)
            .group_by("date")
            .order_by("date")
            .all()
        )
