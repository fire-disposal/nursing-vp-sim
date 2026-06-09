"""persister — save student + patient messages to database."""

import logging

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

        ctx.db.commit()
        await next_mw()
        return

    student_msg = Message(record_id=ctx.record.id, role="student", content=ctx.student_input)
    ctx.db.add(student_msg)

    if ctx.llm_reply:
        patient_msg = Message(record_id=ctx.record.id, role="patient", content=ctx.llm_reply)
        ctx.db.add(patient_msg)
        ctx.db.commit()
        ctx.db.refresh(patient_msg)
        ctx.state["_saved_messages"] = [patient_msg]
        log.info("Persisted: record_id=%d student=%d patient=%d",
                 ctx.record.id, len(ctx.student_input), len(ctx.llm_reply))

    await next_mw()
