"""Training Pipeline — composable middleware chain for message processing."""

from .context import PipelineContext
from .phase import (
    Phase,
    get_phase_by_order,
    parse_phase,
    parse_phases,
    try_advance_phase,
)
from .plugin import run_plugin_hooks
from .registry import get_pipeline
from .runner import PipelineMiddleware, run_pipeline, stream_pipeline

__all__ = [
    "Phase",
    "PipelineContext",
    "PipelineMiddleware",
    "get_phase_by_order",
    "get_pipeline",
    "parse_phase",
    "parse_phases",
    "run_pipeline",
    "run_plugin_hooks",
    "stream_pipeline",
    "try_advance_phase",
]
