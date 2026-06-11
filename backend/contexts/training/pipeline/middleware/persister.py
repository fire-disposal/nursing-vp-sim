"""persister — save student + patient messages to database."""

import logging

from contexts.patient.initiative import update_initiative_timer
from models import Message

from ..context import PipelineContext

log = logging.getLogger(__name__)


async def persister(ctx: PipelineContext, next_mw) -> None:
    if ctx.should_shortcut or ctx.error:
        student_msg = Message(record_id=ctx.record.id, role="student", content=ctx.student_input)
        ctx.db.add(student_msg)

        if ctx.operation:
            op_label = ctx.operation.get("label", "")
            op_value = ctx.operation.get("value", "")
            op_unit = ctx.operation.get("unit", "")
            op_content = f"{op_label}: {op_value}{op_unit}"
            sys_msg = Message(record_id=ctx.record.id, role="system", content=op_content)
            ctx.db.add(sys_msg)
            ctx.state["_saved_messages"] = [sys_msg]

        _persist_phase_op_count(ctx)
        ctx.db.commit()
        _reset_initiative_timer(ctx)
        await next_mw()
        return

    student_msg = Message(record_id=ctx.record.id, role="student", content=ctx.student_input)
    ctx.db.add(student_msg)

    if ctx.llm_reply:
        patient_msg = Message(record_id=ctx.record.id, role="patient", content=ctx.llm_reply)
        ctx.db.add(patient_msg)
        _persist_phase_op_count(ctx)
        ctx.db.commit()
        ctx.db.refresh(patient_msg)
        ctx.state["_saved_messages"] = [patient_msg]
        log.info(
            "Persisted: record_id=%d student=%d patient=%d", ctx.record.id, len(ctx.student_input), len(ctx.llm_reply)
        )

    _reset_initiative_timer(ctx)
    await next_mw()


def _reset_initiative_timer(ctx: PipelineContext) -> None:
    try:
        app_state = ctx.app_state
        if hasattr(app_state, "initiative_cache") and app_state.initiative_cache is not None:
            update_initiative_timer(ctx.record.id, app_state.initiative_cache, len(ctx.student_input or ""))
    except Exception:
        log.warning("Failed to reset initiative timer: record_id=%d", ctx.record.id, exc_info=True)


def _persist_phase_op_count(ctx: PipelineContext) -> None:
    count = ctx.state.get("_phase_op_count")
    if count is not None:
        snapshot = ctx.record.config_snapshot or {}
        snapshot["_phase_op_count"] = count
        ctx.record.config_snapshot = snapshot
