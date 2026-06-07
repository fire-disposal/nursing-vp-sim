"""identity_guard — stub middleware (identity leak handled inside llm_caller)."""

from services.pipeline.context import PipelineContext


async def identity_guard(ctx: PipelineContext, next_mw) -> None:
    await next_mw()
