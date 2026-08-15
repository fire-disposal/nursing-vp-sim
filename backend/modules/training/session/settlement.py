"""Async settlement loop — auto-finalizes expired trainings, auto-abandons stale
sessions, sweeps stuck scoring.

Uses pg_try_advisory_lock to ensure only one worker processes at a time.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, text

from core.database import SessionLocal
from core.statuses import ScoringStatus, TrainingStatus
from infra.queue import QueueFullError
from infra.training_queries import STALE_HOURS, abandon_record, find_stale_records
from models import Message, Notification, Score, TrainingRecord, TrainingSessionState

from .finalize import NO_STUDENT_MESSAGES_REASON, finalize_training

log = logging.getLogger(__name__)

SETTLEMENT_LOCK_KEY = 987654321
STALE_SCORING_SWEEP_MINUTES = 10
# 到期宽限：给前端 autoEnd 弹窗留出操作时间，超时后强制自动结算。
# D5 硬截止：宽限只给最后一条消息落库留余量，不让学生到点后继续对话
EXPIRED_GRACE_SECONDS = 15


async def settlement_loop(*, interval: int = 30, app_state=None) -> None:
    """Background loop: auto-finalize expired, auto-abandon stale, sweep stuck scoring.

    `_settle_once` runs in a worker thread and returns the scoring tasks to enqueue;
    enqueue must happen on the event loop (TaskQueue is async-only).
    """
    while True:
        await asyncio.sleep(interval)
        pending = await asyncio.to_thread(_settle_once, app_state)
        for record_id, case_data in pending:
            await _enqueue_scoring(record_id, case_data, app_state)


def _settle_once(app_state=None) -> list[tuple[int, dict | None]]:
    """One sweep pass. Returns [(record_id, case_data)] ready for scoring enqueue."""
    db = SessionLocal()
    try:
        locked = db.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": SETTLEMENT_LOCK_KEY}).scalar()
        if not locked:
            return []
        try:
            pending = _settle_expired_records(db)
            _abandon_stale_records(db)
            _sweep_stale_scoring_records(db)
            return pending
        finally:
            db.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": SETTLEMENT_LOCK_KEY})
    except Exception:
        db.rollback()
        log.exception("Settlement loop error")
        return []
    finally:
        db.close()


def _find_expired_records(db) -> list[TrainingRecord]:
    """In-progress trainings past their wall-clock deadline + grace period."""
    cutoff = datetime.now(UTC) - timedelta(seconds=EXPIRED_GRACE_SECONDS)
    return (
        db.query(TrainingRecord)
        .filter(
            TrainingRecord.status == TrainingStatus.IN_PROGRESS,
            TrainingRecord.start_time + func.make_interval(0, 0, 0, 0, 0, 0, TrainingRecord.time_limit * 60) < cutoff,
        )
        .all()
    )


def _settle_expired_records(db) -> list[tuple[int, dict | None]]:
    """Auto-finalize expired trainings; returns scoring tasks for the caller to enqueue.

    Each record commits independently so a failure never rolls back siblings.
    """
    now = datetime.now(UTC)
    expired = _find_expired_records(db)
    if not expired:
        return []
    pending: list[tuple[int, dict | None]] = []
    for record in expired:
        try:
            claimed, kind, case_data = finalize_training(db, record.id, ended_at=now)
            if claimed and kind == TrainingStatus.COMPLETED:
                pending.append((record.id, case_data))
            db.commit()
        except Exception:
            db.rollback()
            log.exception("Settlement: failed to finalize expired record_id=%d", record.id)
    log.info("Settlement: auto-finalized %d expired trainings", len(expired))
    return pending


async def _enqueue_scoring(record_id: int, case_data: dict | None, app_state) -> None:
    """Enqueue scoring for an auto-finalized training; reopen the record on queue-full."""
    if app_state is None or not hasattr(app_state, "task_queue"):
        log.warning("Settlement: no task queue, cannot score record_id=%d", record_id)
        return
    try:
        # Delayed import: the scoring router is heavy (FastAPI deps) and this
        # module is imported by bootstrap before routers are ready.
        from modules.training.router.scoring import _run_scoring_background

        await app_state.task_queue.enqueue(
            lambda: _run_scoring_background(
                record_id,
                case_data or {},
                llm_client=app_state.llm_client,
                tracker=getattr(app_state, "scoring_tracker", None),
                realtime_hub=app_state.realtime_hub,
            ),
            priority=5,
        )
    except QueueFullError:
        log.error("Settlement: queue full, reopening record_id=%d for next round", record_id)
        try:
            with SessionLocal() as db2:
                db2.execute(
                    text(
                        "UPDATE training_records "
                        "SET scoring_status = NULL, status = 'in_progress', end_time = NULL "
                        "WHERE id = :id"
                    ),
                    {"id": record_id},
                )
                db2.commit()
        except Exception:
            log.exception("Settlement: failed to reopen record_id=%d", record_id)


def _abandon_stale_records(db) -> None:
    """Auto-abandon in_progress records idle for >STALE_HOURS (safety net)."""
    stale = find_stale_records(db)
    if not stale:
        return
    log.info("Settlement: auto-abandoning %d stale records (>%dh idle)", len(stale), STALE_HOURS)
    for record in stale:
        try:
            abandon_record(db, record.id)
            db.query(TrainingSessionState).filter(TrainingSessionState.record_id == record.id).delete(
                synchronize_session="fetch"
            )
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
            TrainingRecord.scoring_status.in_([ScoringStatus.PENDING, ScoringStatus.PROCESSING]),
            TrainingRecord.end_time < cutoff,
            TrainingRecord.status == TrainingStatus.COMPLETED,
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
    scored_ids = {r[0] for r in db.query(Score.record_id).filter(Score.record_id.in_([r.id for r in stale])).all()}
    for record in stale:
        if record.id in no_student_ids:
            record.scoring_status = None
            record.scoring_error = NO_STUDENT_MESSAGES_REASON
        elif record.id in scored_ids:
            record.scoring_status = ScoringStatus.COMPLETED
            record.scoring_error = None
        else:
            record.scoring_status = ScoringStatus.FAILED
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
