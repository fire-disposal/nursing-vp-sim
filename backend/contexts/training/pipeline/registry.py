"""Pipeline registry — maps phase IDs to middleware chains."""

from .middleware import (
    operation_detector,
    operation_executor,
    persister,
    phase_guard,
    phase_transition,
    prompt_builder,
    side_effects,
)
from .runner import PipelineMiddleware


async def _llm_caller(ctx, next_mw):
    from .middleware.llm_caller import llm_caller as _lc
    await _lc(ctx, next_mw)


_DEFAULT_CHAIN: list[PipelineMiddleware] = [
    phase_guard,
    operation_detector,
    operation_executor,
    phase_transition,
    prompt_builder,
    _llm_caller,
    persister,
    side_effects,
]

PIPELINE_REGISTRY: dict[str, list[PipelineMiddleware]] = {
    "history_taking": _DEFAULT_CHAIN,
    "physical_exam": _DEFAULT_CHAIN,
}


def get_pipeline(phase_id: str) -> list[PipelineMiddleware]:
    """Return the middleware chain for a given phase, or the default chain."""
    return PIPELINE_REGISTRY.get(phase_id, _DEFAULT_CHAIN)
