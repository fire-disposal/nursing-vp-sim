"""Async settlement loop — auto-abandons stale sessions, sweeps stuck scoring.

Uses pg_try_advisory_lock to ensure only one worker processes at a time.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import text

from core.database import SessionLocal
from infra.training_queries import STALE_HOURS, abandon_record, find_stale_records
from models import Message, Notification, Score, TrainingRecord, TrainingSessionState

log = logging.getLogger(__name__)

SETTLEMENT_LOCK_KEY = 987654321
STALE_SCORING_SWEEP_MINUTES = 10
NO_STUDENT_MESSAGES_REASON = "no_student_messages"


def _student_message_count(db, record_id: int) -> int:
    return db.query(Message).filter(Message.record_id == record_id, Message.role == "student").count()


async def settlement_loop(*, interval: int = 30) -> None:
    """Background loop: auto-abandon stale in_progress, sweep stuck scoring."""
    while True:
        await asyncio.sleep(interval)
        await asyncio.to_thread(_settle_once)


def _settle_once() -> None:
    db = SessionLocal()
    try:
        locked = db.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": SETTLEMENT_LOCK_KEY}).scalar()
        if not locked:
            return
        try:
            _abandon_stale_records(db)
            _sweep_stale_scoring_records(db)
        finally:
            db.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": SETTLEMENT_LOCK_KEY})
    except Exception:
        db.rollback()
        log.exception("Settlement loop error")
    finally:
        db.close()


def _abandon_stale_records(db) -> None:
    """Auto-abandon in_progress records idle for >STALE_HOURS (safety net)."""
    stale = find_stale_records(db)
    if not stale:
        return
    log.info("Settlement: auto-abandoning %d stale records (>%dh idle)", len(stale), STALE_HOURS)
    for record in stale:
        try:
            abandon_record(db, record.id)
            db.query(TrainingSessionState).filter(
                TrainingSessionState.record_id == record.id
            ).delete(synchronize_session="fetch")
            db.commit()
            log.info("Settlement: record_id=%d auto-abandoned (stale)", record.id)
        except Exception:
            db.rollback()
            log.exception("Settlement: failed to abandon stale record_id=%d", record.id)


def _sweep_stale_scoring_records(db) -> int:
    """Mark scoring records stuck in pending/processing > STALE_SCORING_SWEEP_MINUTES as failed."""
    cutoff = datetime.now(UTC) - timedelta(minutes=STALE_SCORING_SWEEP_MINUTES)
    stale = (
        db.query(TrainingRecord)
        .filter(
            TrainingRecord.scoring_status.in_(["pending", "processing"]),
            TrainingRecord.end_time < cutoff,
            TrainingRecord.status == "completed",
        )
        .all()
    )
    if not stale:
        return 0

    no_student_ids = {
        r.id
        for r in db.query(TrainingRecord.id).filter(
            TrainingRecord.id.in_([r.id for r in stale]),
            ~TrainingRecord.id.in_(
                db.query(Message.record_id).filter(
                    Message.record_id.in_([r.id for r in stale]),
                    Message.role == "student",
                )
            ),
        )
    }
    scored_ids = {
        r[0]
        for r in db.query(Score.record_id).filter(Score.record_id.in_([r.id for r in stale])).all()
    }
    for record in stale:
        if record.id in no_student_ids:
            record.scoring_status = None
            record.scoring_error = NO_STUDENT_MESSAGES_REASON
        elif record.id in scored_ids:
            record.scoring_status = "completed"
            record.scoring_error = None
        else:
            record.scoring_status = "failed"
            record.scoring_error = "评分超时，已自动标记失败，可手动重试"
            db.add(
                Notification(
                    user_id=record.user_id,
                    record_id=record.id,
                    type="scoring_failed",
                    title="评分失败",
                    body="评分超时，已自动标记失败，可在记录详情页重新评分",
                )
            )
            log.warning("settlement: stale scoring marked failed", extra={"record_id": record.id})
    db.commit()
    return len(stale)
