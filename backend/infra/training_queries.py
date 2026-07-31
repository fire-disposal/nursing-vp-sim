"""Training query helpers for settlement and background tasks."""

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from models import TrainingRecord

STALE_HOURS = 24


def find_stale_records(db: Session) -> list[TrainingRecord]:
    """Find in_progress records with no activity for >24h — auto-abandon as safety net.

    Last activity is the most recent message, falling back to record creation
    when no message exists. Using creation time alone would abandon a session
    that is still actively used past 24h.
    """
    from datetime import timedelta

    from sqlalchemy import func

    from models import Message

    cutoff = datetime.now(UTC) - timedelta(hours=STALE_HOURS)
    last_msg = (
        db.query(Message.record_id, func.max(Message.created_at).label("last_activity"))
        .group_by(Message.record_id)
        .subquery()
    )
    return (
        db.query(TrainingRecord)
        .outerjoin(last_msg, last_msg.c.record_id == TrainingRecord.id)
        .filter(TrainingRecord.status == "in_progress")
        .filter(func.coalesce(last_msg.c.last_activity, TrainingRecord.start_time) < cutoff)
        .all()
    )


def abandon_record(db: Session, record_id: int) -> None:
    """Auto-abandon a stale record (safety net for abandoned sessions)."""
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if record and record.status == "in_progress":
        record.status = "abandoned"
        record.end_time = datetime.now(UTC)
