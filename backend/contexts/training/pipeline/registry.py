"""Pipeline registry — dynamically assembles middleware chains per feature flags."""

from typing import Any

from plugins.manager import build_pipeline as _build_pipeline


def get_pipeline(feature_flags: dict[str, bool] | None = None) -> tuple[list, Any]:
    return _build_pipeline(feature_flags or {})
