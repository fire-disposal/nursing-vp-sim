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


def get_pipeline(phase_id: str, feature_flags: dict[str, bool] | None = None) -> list:
    """获取流水线，优先使用动态组装"""
    flags = feature_flags or {}
    return build_pipeline(flags)


def build_pipeline(feature_flags: dict[str, bool]) -> list:
    """根据 feature_flags 动态组装流水线中间件链"""
    from .middleware.phase_guard import phase_guard
    from .middleware.phase_transition import phase_transition
    from .middleware.prompt_builder import prompt_builder
    from .middleware.llm_caller import _llm_caller
    from .middleware.persister import persister
    from .plugin import get_active_plugins

    core = [phase_guard, phase_transition, prompt_builder, _llm_caller, persister]

    plugins = get_active_plugins(feature_flags)
    plugin_middlewares = []
    for plugin in plugins:
        plugin_middlewares.extend(plugin.middleware)

    # guard → [plugin_middlewares] → transition → prompt_builder → llm → persister
    return [phase_guard] + plugin_middlewares + [phase_transition, prompt_builder, _llm_caller, persister]
