"""Training finalization — shared atomic end-of-training logic.

Used by the HTTP `POST /{record_id}/end` endpoint and the settlement loop's
timeout sweep. `finalize_training` is idempotent: only an in_progress record
with no active scoring can be claimed (row lock + `acquire_scoring`), so
concurrent end requests and the settlement sweep can never double-finalize.
The caller owns the transaction — commit after the scoring task is enqueued,
rollback on enqueue failure.
"""

import logging
from datetime import UTC, datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from core.datetime_utils import ensure_utc
from core.statuses import ScoringStatus, TrainingStatus
from models import Case, Message, NursingRecord, TrainingRecord, TrainingSessionState

from ..scoring.lifecycle import acquire_scoring

log = logging.getLogger(__name__)

NO_STUDENT_MESSAGES_REASON = "no_student_messages"
NO_STUDENT_MESSAGES_MESSAGE = "本次训练没有有效问诊内容，未生成评分"


def student_message_count(db: Session, record_id: int) -> int:
    return (
        db.query(func.count(Message.id))
        .filter(
            Message.record_id == record_id,
            Message.role == "student",
        )
        .scalar()
        or 0
    )


def set_overdue_if_needed(record: TrainingRecord, db: Session) -> None:
    """Mark assignment-linked records overdue when they end after the assignment deadline."""
    if not record.assignment_id or record.is_overdue:
        return
    from models import Assignment

    assignment = db.query(Assignment).filter(Assignment.id == record.assignment_id).first()
    if assignment and record.end_time and ensure_utc(record.end_time) > ensure_utc(assignment.end_time):
        record.is_overdue = True


def mark_discarded(db: Session, record: TrainingRecord, *, ended_at: datetime | None = None) -> None:
    """Terminal state for records with no student messages — discarded, never failed/scored."""
    record.status = TrainingStatus.DISCARDED
    record.end_time = ended_at or record.end_time or datetime.now(UTC)
    record.scoring_status = None
    record.scoring_error = NO_STUDENT_MESSAGES_REASON
    set_overdue_if_needed(record, db)
    db.query(TrainingSessionState).filter(TrainingSessionState.record_id == record.id).delete()
    # T8：discarded 记录同样清理 v3 情绪行
    try:
        from modules.training.patient_ai.emotion import EmotionRepository

        EmotionRepository().cleanup(record.id, db)
    except Exception:
        log.warning("Emotion cleanup failed on discard: record_id=%d", record.id, exc_info=True)


def finalize_training(
    db: Session,
    record_id: int,
    *,
    ended_at: datetime | None = None,
) -> tuple[bool, str | None, dict | None]:
    """Atomically finish a training.

    Returns ``(claimed, kind, case_data)``:
      - ``(False, None, None)`` — record not finalizable (gone, already ended,
        scoring in flight, or claimed by a concurrent request).
      - ``(True, "discarded", None)`` — no student messages; no scoring task.
      - ``(True, "completed", case_data)`` — ready for a scoring task.

    Caller MUST commit (or rollback on enqueue failure). The row lock and the
    `acquire_scoring` UPDATE are held inside this transaction.
    """
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).with_for_update().first()
    if not record:
        return False, None, None
    if record.status != TrainingStatus.IN_PROGRESS:
        return False, None, None
    if record.scoring_status in (ScoringStatus.PENDING, ScoringStatus.PROCESSING):
        return False, None, None
    if not acquire_scoring(record_id, db):
        return False, None, None
    db.refresh(record)  # pick up acquire_scoring's 'pending' so later clears are real changes

    ended = ended_at or datetime.now(UTC)
    if student_message_count(db, record_id) == 0:
        mark_discarded(db, record, ended_at=ended)
        return True, TrainingStatus.DISCARDED, None

    case = db.query(Case).filter(Case.id == record.case_id).first()
    case_data = record.case_snapshot or (case.case_data if case else {})

    # Auto-submit nursing assessment if it exists but wasn't explicitly submitted.
    nr = db.query(NursingRecord).filter(NursingRecord.record_id == record_id).first()
    if nr is not None and nr.submitted_at is None:
        nr.submitted_at = ended
        nr.status = "submitted"
        nr.updated_at = ended

    record.status = TrainingStatus.COMPLETED
    record.end_time = ended
    set_overdue_if_needed(record, db)
    return True, TrainingStatus.COMPLETED, case_data


def cleanup_session_runtime(record: TrainingRecord, app_state, db: Session) -> None:
    """Best-effort teardown of runtime caches (initiative/emotion). Never raises."""
    try:
        from modules.training.capabilities import detect_capabilities

        features = detect_capabilities(
            case_data=record.case_snapshot or {},
            training_type=record.training_type or "history_taking",
            overrides=(record.practice_snapshot or {}).get("features"),
        )
        if features.get("patient_initiative") and getattr(app_state, "initiative_cache", None):
            from modules.training.patient_ai.initiative import cleanup_initiative

            cleanup_initiative(record.id, app_state.initiative_cache, db)
        if features.get("emotion"):
            from modules.training.patient_ai.emotion import EmotionRepository

            EmotionRepository().cleanup(record.id, db)
    except Exception:
        log.warning("Session runtime cleanup failed: record_id=%d", record.id, exc_info=True)
