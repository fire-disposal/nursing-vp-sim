"""persister — save student + patient messages to database."""

import logging

from models import Message
from modules.training.patient_ai.initiative import update_initiative_timer

from ..context import (
    STATE_CORRECTION_TARGET,
    STATE_DONE_PAYLOAD,
    STATE_SAVED_MESSAGES,
    PipelineContext,
)

log = logging.getLogger(__name__)


async def persister(ctx: PipelineContext, next_mw) -> None:
    if ctx.should_shortcut or ctx.error:
        _persist_shortcut(ctx)
        await next_mw()
        return

    if ctx.state.get(STATE_CORRECTION_TARGET):
        _persist_correction(ctx)
    else:
        _persist_normal(ctx)
    await next_mw()


def _persist_shortcut(ctx: PipelineContext) -> None:
    """Persist partial reply after error — messages only, no initiative timer."""
    student_msg = Message(record_id=ctx.record.id, role="student", content=ctx.student_input)
    ctx.db.add(student_msg)
    if ctx.llm_reply and ctx.llm_reply.strip():
        patient_msg = Message(record_id=ctx.record.id, role="patient", content=ctx.llm_reply)
        ctx.db.add(patient_msg)
        ctx.db.commit()
        ctx.db.refresh(patient_msg)
        ctx.state[STATE_SAVED_MESSAGES] = [patient_msg]
        log.warning("Persisted partial reply after error: record_id=%d len=%d", ctx.record.id, len(ctx.llm_reply))
    else:
        ctx.db.commit()


def _persist_normal(ctx: PipelineContext) -> None:
    """Persist student + patient messages, then initiative timer separately.

    Initiative timer update runs in its own transaction so a timer failure
    never rolls back message persistence.
    """
    student_msg = Message(record_id=ctx.record.id, role="student", content=ctx.student_input)
    ctx.db.add(student_msg)

    if ctx.llm_reply:
        patient_msg = Message(record_id=ctx.record.id, role="patient", content=ctx.llm_reply)
        ctx.db.add(patient_msg)
        ctx.db.commit()
        ctx.db.refresh(patient_msg)
        ctx.state[STATE_SAVED_MESSAGES] = [patient_msg]
        log.info(
            "Persisted: record_id=%d student=%d patient=%d", ctx.record.id, len(ctx.student_input), len(ctx.llm_reply)
        )
    else:
        ctx.db.commit()

    _reset_initiative_timer(ctx)


def _persist_correction(ctx: PipelineContext) -> None:
    """Replace the last student/patient pair after the replacement reply succeeds."""
    target = ctx.state.get(STATE_CORRECTION_TARGET) or {}
    old_student = target.get("student")
    old_patient = target.get("patient")
    if old_student is None:
        raise ValueError("correction target missing student message")

    if old_patient is not None:
        ctx.db.delete(old_patient)
    ctx.db.delete(old_student)
    ctx.db.flush()

    student_msg = Message(record_id=ctx.record.id, role="student", content=ctx.student_input)
    ctx.db.add(student_msg)

    patient_msg = Message(record_id=ctx.record.id, role="patient", content=ctx.llm_reply or "")
    ctx.db.add(patient_msg)
    ctx.db.flush()

    correction = _next_correction_state(
        ctx.record.runtime_state or {},
        old_student=old_student,
        old_patient=old_patient,
        student_msg=student_msg,
        patient_msg=patient_msg,
    )
    runtime_state = dict(ctx.record.runtime_state or {})
    runtime_state["message_correction"] = correction
    ctx.record.runtime_state = runtime_state

    ctx.db.commit()
    ctx.db.refresh(student_msg)
    ctx.db.refresh(patient_msg)
    ctx.state[STATE_SAVED_MESSAGES] = [student_msg, patient_msg]
    ctx.state[STATE_DONE_PAYLOAD] = {
        "student_id": student_msg.id,
        "patient_id": patient_msg.id,
        "corrections_used": correction["used"],
        "corrections_remaining": max(0, correction["limit"] - correction["used"]),
    }
    log.info(
        "Corrected last message: record_id=%d old_student=%s old_patient=%s new_student=%d new_patient=%d",
        ctx.record.id,
        getattr(old_student, "id", None),
        getattr(old_patient, "id", None),
        student_msg.id,
        patient_msg.id,
    )
    _reset_initiative_timer(ctx)


def _next_correction_state(
    runtime_state: dict,
    *,
    old_student: Message,
    old_patient: Message | None,
    student_msg: Message,
    patient_msg: Message,
) -> dict:
    current = runtime_state.get("message_correction")
    if not isinstance(current, dict):
        current = {}
    limit = int(current.get("limit") or 3)
    used = int(current.get("used") or 0) + 1
    history = current.get("history")
    if not isinstance(history, list):
        history = []
    history = [
        *history[-2:],
        {
            "old_student_id": old_student.id,
            "old_patient_id": getattr(old_patient, "id", None),
            "old_student_content": old_student.content,
            "old_patient_content": getattr(old_patient, "content", None),
            "new_student_id": student_msg.id,
            "new_patient_id": patient_msg.id,
        },
    ]
    return {"used": used, "limit": limit, "history": history}


def _reset_initiative_timer(ctx: PipelineContext) -> None:
    """Reset initiative timer in its own transaction; failures don't affect messages."""
    try:
        app_state = ctx.app_state
        if hasattr(app_state, "initiative_cache") and app_state.initiative_cache is not None:
            update_initiative_timer(ctx.record.id, app_state.initiative_cache, ctx.db)
            ctx.db.commit()
    except Exception:
        try:
            ctx.db.rollback()
        except Exception:
            pass
        log.warning("Failed to reset initiative timer: record_id=%d", ctx.record.id, exc_info=True)
