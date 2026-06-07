"""phase_transition — check if phase should advance."""

import logging

from services.pipeline.context import PipelineContext
from services.pipeline.phase import try_advance_phase

log = logging.getLogger(__name__)


async def phase_transition(ctx: PipelineContext, next_mw) -> None:
    if not ctx.current_phase:
        await next_mw()
        return

    next_phase = try_advance_phase(
        ctx.current_phase,
        ctx.phases,
        ctx.message_count,
        ctx.phase_operation_count,
        manual_requested=ctx.manual_advance_requested,
    )

    if next_phase:
        log.info("Phase transition: record_id=%d %s -> %s",
                 ctx.record.id, ctx.current_phase.id, next_phase.id)
        ctx.current_phase = next_phase
        ctx.phase_index = next_phase.order - 1
        ctx.record.current_phase = next_phase.id
        ctx.phase_operation_count = 0
        ctx.manual_advance_requested = False

    await next_mw()
