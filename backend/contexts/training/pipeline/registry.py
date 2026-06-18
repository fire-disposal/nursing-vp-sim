"""Pipeline registry — dynamically assembles middleware chains per feature flags."""

from typing import Any

from .builder import build_pipeline


def get_pipeline(feature_flags: dict[str, bool] | None = None) -> tuple[list, Any]:
    return build_pipeline(feature_flags or {})
