"""Pipeline registry — dynamically assembles middleware chains per capabilities."""

from typing import Any

from .builder import build_pipeline


def get_pipeline() -> tuple[list, Any]:
    return build_pipeline()
