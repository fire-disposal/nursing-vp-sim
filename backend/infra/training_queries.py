"""Training query helpers for settlement and background tasks."""

from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

from core.datetime_utils import ensure_utc
from models import Assignment, TrainingRecord


STALE_HOURS = 24


def find_stale_records(db: Session) -> list[TrainingRecord]:
    """Find in_progress records idle for >24h — auto-abandon as safety net."""
    from datetime import timedelta

    cutoff = datetime.now(UTC) - timedelta(hours=STALE_HOURS)
    return (
        db.query(TrainingRecord)
        .filter(TrainingRecord.status == "in_progress")
        .filter(TrainingRecord.start_time < cutoff)
        .all()
    )


def abandon_record(db: Session, record_id: int) -> None:
    """Auto-abandon a stale record (safety net for abandoned sessions)."""
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if record and record.status == "in_progress":
        record.status = "abandoned"
        record.end_time = datetime.now(UTC)
