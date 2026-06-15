"""side_effects — update initiative timer and other post-reply effects."""

from contexts.patient import update_initiative_timer

from ..context import PipelineContext


async def side_effects(ctx: PipelineContext, next_mw) -> None:
    await next_mw()

    if ctx.error or ctx.should_shortcut:
        return

    features = ctx.state.get("features") or {}
    if features.get("patient_initiative") and ctx.llm_reply:
        cache = ctx.app_state.initiative_cache
        update_initiative_timer(ctx.record.id, cache, len(ctx.llm_reply))
