"""operation_executor — execute detected operation, inject result."""

import logging

from contexts.patient import handle_operation
from ..context import PipelineContext

log = logging.getLogger(__name__)


async def operation_executor(ctx: PipelineContext, next_mw) -> None:
    op_type = ctx.state.get("_detected_op")
    if op_type is None:
        await next_mw()
        return

    result = handle_operation(op_type, ctx.case_data)
    ctx.operation = result

    op_label = result.get("label", "")
    op_value = result.get("value", "")
    op_unit = result.get("unit", "")

    ctx.state["_operation_note"] = f"护士刚给你做了{op_label}，结果是{op_value}{op_unit}。"
    ctx.student_display = "（护士正在为你做检查，你看到了结果）"

    ctx.phase_operation_count += 1
    ctx.state["_phase_op_count"] = ctx.phase_operation_count

    ctx.system_events.append({
        "system": f"{op_label}: {op_value}{op_unit}"
    })

    ctx.should_shortcut = True
    ctx.llm_reply = None

    log.info("Operation executed: record_id=%d op=%s result=%s",
             ctx.record.id, op_type, str(op_value)[:60])
