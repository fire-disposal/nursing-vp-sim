"""Training query helpers for settlement and background tasks."""

from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

from core.datetime_utils import ensure_utc
from models import Assignment, TrainingRecord


def find_timeout_records(db: Session) -> list[TrainingRecord]:
    """Find training records that have timed out."""
    now = datetime.now(UTC)
    return (
        db.query(TrainingRecord)
        .filter(TrainingRecord.status == "in_progress")
        .filter(
            text(
                "training_records.start_time + (training_records.time_limit * interval '1 minute') < :now"
            ).bindparams(now=now)
        )
        .all()
    )


def mark_completed(db: Session, record_id: int) -> None:
    """Mark a training record as completed (used in settlement)."""
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if record:
        record.status = "completed"
        record.end_time = datetime.now(UTC)
        record.scoring_status = "pending"
        if record.assignment_id and not record.is_overdue:
            assignment = db.query(Assignment).filter(Assignment.id == record.assignment_id).first()
            if assignment and record.end_time and ensure_utc(record.end_time) > ensure_utc(assignment.end_time):
                record.is_overdue = True
