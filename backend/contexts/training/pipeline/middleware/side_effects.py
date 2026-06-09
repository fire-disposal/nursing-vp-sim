"""side_effects — update initiative timer and other post-reply effects."""

from services.feature_flags import is_enabled
from contexts.patient import update_initiative_timer
from ..context import PipelineContext


async def side_effects(ctx: PipelineContext, next_mw) -> None:
    await next_mw()

    if ctx.error or ctx.should_shortcut:
        return

    if is_enabled(ctx.record, "patient_initiative") and ctx.llm_reply:
        update_initiative_timer(ctx.record.id, len(ctx.llm_reply))
