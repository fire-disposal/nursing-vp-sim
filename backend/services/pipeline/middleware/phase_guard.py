"""phase_guard — reject operations not allowed in current phase."""

import logging
from services.pipeline.context import PipelineContext

log = logging.getLogger(__name__)


async def phase_guard(ctx: PipelineContext, next_mw) -> None:
    if ctx.current_phase is None:
        ctx.error = "当前训练无有效阶段配置"
        return
    await next_mw()
