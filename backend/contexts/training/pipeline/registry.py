"""Pipeline registry — dynamically assembles middleware chains per feature flags."""

from typing import Any


def get_pipeline(feature_flags: dict[str, bool] | None = None) -> tuple[list, Any]:
    flags = feature_flags or {}
    return build_pipeline(flags)


def build_pipeline(feature_flags: dict[str, bool]) -> tuple[list, Any]:
    from plugins.manager import get_plugin_manager

    pm = get_plugin_manager()
    middlewares, collector = pm.build_pipeline(feature_flags)
    return middlewares, collector
