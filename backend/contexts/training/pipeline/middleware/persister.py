"""persister — save student + patient messages to database."""

import logging

from models import Message
from prompts.training.initiative import update_initiative_timer

from ..context import (
    STATE_SAVED_MESSAGES,
    PipelineContext,
)

log = logging.getLogger(__name__)


async def persister(ctx: PipelineContext, next_mw) -> None:
    if ctx.should_shortcut or ctx.error:
        _persist_shortcut(ctx)
        await next_mw()
        return

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
