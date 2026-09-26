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
from models import Case, Message, TrainingRecord, TrainingSessionState

from ..profile import HISTORY_TAKING, record_activity_available
from ..scoring.lifecycle import acquire_scoring
from ..tools.nursing_record import (
    NursingAssessmentRequiredError,
    get_nursing_record,
    is_submitted,
    missing_fields,
)

log = logging.getLogger(__name__)

NO_STUDENT_MESSAGES_REASON = "no_student_messages"
NO_STUDENT_MESSAGES_MESSAGE = "本次训练没有有效问诊内容，未生成评分"
# runtime_state 上「患者主动中止访谈」的键：chat 准入守卫与前端读取的唯一真值
PATIENT_WALKOUT_KEY = "patient_walkout"
# runtime_state 上「本次训练为什么结束」的键 —— 用户主动完成与系统终止必须可区分
TERMINAL_STATE_KEY = "terminal"

#: 结束来源：谁终结了这次训练（写入 runtime_state[TERMINAL_STATE_KEY]）
END_ORIGIN_USER = "user_end"
END_ORIGIN_TIMEOUT = "timeout"
END_ORIGIN_PATIENT_WALKOUT = "patient_walkout"


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


def mark_patient_walkout(record: TrainingRecord, *, at: datetime) -> None:
    """标记「患者主动中止访谈」。

    写入 runtime_state（而非另建字段）：该标记是 chat 准入守卫、前端提示与审计的
    唯一真值；真正的终结仍由 ``finalize_training`` 承担，标记只回答「为什么结束」。
    """
    state = dict(record.runtime_state or {})
    state[PATIENT_WALKOUT_KEY] = {"reason": PATIENT_WALKOUT_KEY, "at": at.isoformat()}
    record.runtime_state = state


def is_patient_walkout_ended(record: TrainingRecord) -> bool:
    """患者是否已中止访谈（不可再继续对话）。"""
    return PATIENT_WALKOUT_KEY in (record.runtime_state or {})


def mark_terminal_reason(record: TrainingRecord, *, reason: str, at: datetime) -> None:
    """记录「本次训练为什么结束」—— 用户主动完成 ≠ 系统终止（超时/患者离开）。

    写入 runtime_state（而非另建字段）：不需要迁移，且与 ``PATIENT_WALKOUT_KEY``
    同源可审计。系统终止**不得**借此伪造「学生已提交评估」——提交状态只认
    ``NursingRecord.submitted_at``。
    """
    state = dict(record.runtime_state or {})
    state[TERMINAL_STATE_KEY] = {"reason": reason, "at": at.isoformat()}
    record.runtime_state = state


def terminal_reason(record: TrainingRecord) -> str | None:
    """本次训练的终端原因（``user_end`` / ``timeout`` / ``patient_walkout``），无则 None。"""
    info = (record.runtime_state or {}).get(TERMINAL_STATE_KEY)
    if isinstance(info, dict):
        reason = info.get("reason")
        return str(reason) if reason else None
    return None


def finalize_training(
    db: Session,
    record_id: int,
    *,
    ended_at: datetime | None = None,
    origin: str = END_ORIGIN_USER,
    require_nursing_submission: bool = False,
) -> tuple[bool, str | None, dict | None]:
    """Atomically finish a training.

    Returns ``(claimed, kind, case_data)``:
      - ``(False, None, None)`` — record not finalizable (gone, already ended,
        scoring in flight, or claimed by a concurrent request).
      - ``(True, "discarded", None)`` — no student messages; no scoring task.
      - ``(True, "completed", case_data)`` — ready for a scoring task.

    ``origin`` records *why* the session ended (user / timeout / patient walkout)
    into ``runtime_state[TERMINAL_STATE_KEY]``; ``require_nursing_submission``
    enforces the workflow precondition for **user-initiated** completion (see
    below). System termination passes ``False`` and therefore never fabricates a
    student submission — but it also never bypasses it: an unsubmitted draft is
    simply absent from the scoring evidence.

    Raises:
        NursingAssessmentRequiredError: ``require_nursing_submission`` and the
            workflow enables ``nursing_record``, but no frozen (submitted)
            version exists. Raised *before* claiming scoring, so a rejected
            completion leaves no trace.

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

    ended = ended_at or datetime.now(UTC)

    if student_message_count(db, record_id) == 0:
        # 无学生问诊内容 → 废弃，不评分（也不需要评估前置条件）。
        if not acquire_scoring(record_id, db):
            return False, None, None
        db.refresh(record)  # pick up acquire_scoring's 'pending' so later clears are real changes
        mark_discarded(db, record, ended_at=ended)
        mark_terminal_reason(record, reason=origin, at=ended)
        return True, TrainingStatus.DISCARDED, None

    # 用户主动完成 + 本次 workflow 要求护理评估 → 必须先有「已提交」的冻结版本。
    # 显式拒绝（而不是把草稿偷偷改成 submitted）：提交是学生的动作，不是系统的副作用。
    # 检查放在 acquire_scoring 之前，被拒的请求不留 scoring 占位。
    if require_nursing_submission and record_activity_available(record, "nursing_record"):
        nr = get_nursing_record(db, record_id)
        if not is_submitted(nr):
            raise NursingAssessmentRequiredError(
                missing_fields=missing_fields(nr.sheet_data if nr is not None else None),
            )

    if not acquire_scoring(record_id, db):
        return False, None, None
    db.refresh(record)

    case = db.query(Case).filter(Case.id == record.case_id).first()
    case_data = record.case_snapshot or (case.case_data if case else {})

    record.status = TrainingStatus.COMPLETED
    record.end_time = ended
    set_overdue_if_needed(record, db)
    mark_terminal_reason(record, reason=origin, at=ended)
    return True, TrainingStatus.COMPLETED, case_data


def cleanup_session_runtime(record: TrainingRecord, app_state, db: Session) -> None:
    """Best-effort teardown of runtime caches (initiative/emotion). Never raises."""
    try:
        features = HISTORY_TAKING.resolve_features(
            record.case_snapshot or {},
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
