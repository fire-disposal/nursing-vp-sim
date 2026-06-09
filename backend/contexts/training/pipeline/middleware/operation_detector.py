"""operation_detector — detect slash commands in student input."""

import logging

from contexts.patient import detect_operation
from core.feature_flags import is_enabled
from ..context import PipelineContext

log = logging.getLogger(__name__)


async def operation_detector(ctx: PipelineContext, next_mw) -> None:
    if not is_enabled(ctx.record, "physical_exam"):
        await next_mw()
        return

    op_type = detect_operation(ctx.student_input)
    if op_type and ctx.current_phase and ctx.current_phase.supports_operation(op_type):
        ctx.state["_detected_op"] = op_type

    await next_mw()
