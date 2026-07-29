"""Async settlement loop — auto-completes timed-out training sessions.

Uses pg_try_advisory_lock to ensure only one worker processes at a time.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import text

from core.database import SessionLocal
from models import Message, Notification, Score, TrainingRecord, TrainingSessionState

log = logging.getLogger(__name__)

SETTLEMENT_LOCK_KEY = 987654321
STALE_SCORING_SWEEP_MINUTES = 10
NO_STUDENT_MESSAGES_REASON = "no_student_messages"


def _student_message_count(db, record_id: int) -> int:
    return db.query(Message).filter(Message.record_id == record_id, Message.role == "student").count()


def _discard_unscoreable_record(db, record: TrainingRecord) -> None:
    record.status = "discarded"
    record.end_time = record.end_time or datetime.now(UTC)
    record.scoring_status = None
    record.scoring_error = NO_STUDENT_MESSAGES_REASON
    db.query(TrainingSessionState).filter(TrainingSessionState.record_id == record.id).delete(
        synchronize_session="fetch"
    )


async def settlement_loop(
    repo,
    *,
    interval: int = 30,
    enqueue_scoring=None,
) -> None:
    while True:
        await asyncio.sleep(interval)
        settled: list[tuple[int, int, dict]] = await asyncio.to_thread(_settle_with_lock, repo)
        for record_id, case_id, case_data in settled:
            if enqueue_scoring:
                try:
                    await enqueue_scoring(record_id, case_data)
                    log.info("Settlement: enqueued scoring for record_id=%d", record_id)
                except Exception:
                    log.exception("Settlement: failed to enqueue scoring for record_id=%d", record_id)
                    _revert_settled_record(repo, record_id)


def _settle_with_lock(repo) -> list[tuple[int, int, dict]]:
    db = SessionLocal()
    settled: list[tuple[int, int, dict]] = []
    try:
        locked = db.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": SETTLEMENT_LOCK_KEY}).scalar()
        if not locked:
            return settled
        try:
            settled = _settle_once_sync(repo, db)
        finally:
            db.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": SETTLEMENT_LOCK_KEY})
    except Exception:
        db.rollback()
        log.exception("Settlement loop error")
    finally:
        db.close()
    return settled


def _revert_settled_record(repo, record_id: int) -> None:
    db = SessionLocal()
    try:
        record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        if record and record.status == "completed":
            record.status = "in_progress"
            record.end_time = None
            db.commit()
    except Exception:
        db.rollback()
        log.exception("Settlement revert failed for record_id=%d", record_id)
    finally:
        db.close()


def _sweep_stale_scoring_records(db) -> int:
    """Mark scoring records stuck in pending/processing > STALE_SCORING_SWEEP_MINUTES as failed.

    If a Score already exists for the record, correct status to 'completed' instead of 'failed'
    (consistent with _resolve_terminal_status used by _handle_scoring_failure and startup recovery).
    """
    cutoff = datetime.now(UTC) - timedelta(minutes=STALE_SCORING_SWEEP_MINUTES)
    stale = (
        db.query(TrainingRecord)
        .filter(
            TrainingRecord.scoring_status.in_(["pending", "processing"]),
            TrainingRecord.end_time.isnot(None),
            TrainingRecord.end_time < cutoff,
        )
        .all()
    )
    if not stale:
        return 0

    stale_ids = [r.id for r in stale]
    scored_ids = set()
    if stale_ids:
        scored_ids = {r[0] for r in db.query(Score.record_id).filter(Score.record_id.in_(stale_ids)).all()}

    no_student_ids = {
        record_id
        for (record_id,) in db.query(TrainingRecord.id)
        .filter(TrainingRecord.id.in_(stale_ids))
        .filter(
            ~db.query(Message.id).filter(Message.record_id == TrainingRecord.id, Message.role == "student").exists()
        )
        .all()
    }

    for record in stale:
        if record.id in no_student_ids:
            _discard_unscoreable_record(db, record)
            log.info("settlement: stale scoring discarded (no student messages)", extra={"record_id": record.id})
            continue

        if record.id in scored_ids:
            record.scoring_status = "completed"
            record.scoring_error = None
            log.info("settlement: stale scoring corrected to completed (Score exists)", extra={"record_id": record.id})
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


def _settle_once_sync(repo, db) -> list[tuple[int, int, dict]]:
    timeout_records = repo.find_timeout_records_sync(db)
    settled: list[tuple[int, int, dict]] = []

    if timeout_records:
        log.info("Found %d timed-out sessions, marking completed", len(timeout_records))
        for record in timeout_records:
            # Discard records with no student messages — nothing to score and not a failure.
            if _student_message_count(db, record.id) == 0:
                _discard_unscoreable_record(db, record)
                db.commit()
                log.info("Settlement: discarded record_id=%d (no student messages)", record.id)
                continue

            try:
                repo.mark_completed_sync(db, record.id)

                from models import Case, TrainingSessionState

                db.query(TrainingSessionState).filter(TrainingSessionState.record_id == record.id).delete(
                    synchronize_session="fetch"
                )

                case = db.query(Case).filter(Case.id == record.case_id).first()
                case_data = case.case_data if case else {}
                settled.append((record.id, record.case_id, case_data))

                db.commit()
                log.info("Settlement: record_id=%d completed", record.id)
            except Exception:
                db.rollback()
                log.exception("Settlement record_id=%d failed", record.id)

    try:
        stale_count = _sweep_stale_scoring_records(db)
        if stale_count:
            log.info("Settlement: marked %d stale scoring records as failed", stale_count)
    except Exception:
        db.rollback()
        log.exception("settlement stale scoring sweep failed")

    return settled
