"""persister — save student + patient messages to database."""

import logging

from contexts.patient.initiative import update_initiative_timer
from models import Message

from ..context import (
    STATE_PHASE_OP_COUNT,
    STATE_SAVED_MESSAGES,
    PipelineContext,
)

log = logging.getLogger(__name__)


async def persister(ctx: PipelineContext, next_mw) -> None:
    if ctx.should_shortcut or ctx.error:
        student_msg = Message(record_id=ctx.record.id, role="student", content=ctx.student_input)
        ctx.db.add(student_msg)
        _persist_phase_op_count(ctx)
        ctx.db.commit()
        await next_mw()
        _reset_initiative_timer(ctx)
        return

    student_msg = Message(record_id=ctx.record.id, role="student", content=ctx.student_input)
    ctx.db.add(student_msg)

    if ctx.llm_reply:
        patient_msg = Message(record_id=ctx.record.id, role="patient", content=ctx.llm_reply)
        ctx.db.add(patient_msg)
        _persist_phase_op_count(ctx)
        ctx.db.commit()
        ctx.db.refresh(patient_msg)
        ctx.state[STATE_SAVED_MESSAGES] = [patient_msg]
        log.info(
            "Persisted: record_id=%d student=%d patient=%d", ctx.record.id, len(ctx.student_input), len(ctx.llm_reply)
        )

    await next_mw()

    _reset_initiative_timer(ctx)


def _reset_initiative_timer(ctx: PipelineContext) -> None:
    try:
        app_state = ctx.app_state
        if hasattr(app_state, "initiative_cache") and app_state.initiative_cache is not None:
            update_initiative_timer(ctx.record.id, app_state.initiative_cache, ctx.db)
    except Exception:
        log.warning("Failed to reset initiative timer: record_id=%d", ctx.record.id, exc_info=True)


def _persist_phase_op_count(ctx: PipelineContext) -> None:
    count = ctx.state.get(STATE_PHASE_OP_COUNT)
    if count is not None:
        rs = dict(ctx.record.runtime_state or {})
        rs["phase_op_count"] = count
        ctx.record.runtime_state = rs
