"""Pipeline registry — dynamically assembles middleware chains per capabilities."""

from typing import Any

from .builder import build_pipeline


def get_pipeline(training_type: str | None = None) -> tuple[list, Any]:
    return build_pipeline(training_type=training_type)
