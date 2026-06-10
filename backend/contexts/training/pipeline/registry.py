"""Pipeline registry — dynamically assembles middleware chains per feature flags."""

from .middleware import (
    persister,
    phase_guard,
    phase_transition,
    prompt_builder,
    side_effects,
)
from .middleware.llm_caller import llm_caller


def get_pipeline(phase_id: str, feature_flags: dict[str, bool] | None = None) -> list:
    flags = feature_flags or {}
    return build_pipeline(flags)


def build_pipeline(feature_flags: dict[str, bool]) -> list:
    from .plugin import get_active_plugins

    core = [phase_guard, phase_transition, prompt_builder, llm_caller, persister]

    plugins = get_active_plugins(feature_flags)
    plugin_middlewares: list = []
    for plugin in plugins:
        plugin_middlewares.extend(plugin.middleware)

    return [phase_guard] + plugin_middlewares + [phase_transition, prompt_builder, llm_caller, persister, side_effects]
