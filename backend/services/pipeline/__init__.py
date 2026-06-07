"""Training Pipeline — composable middleware chain for message processing."""

from .phase import (
    Phase,
    get_phase_by_order,
    parse_phase,
    parse_phases,
    try_advance_phase,
)
from .context import PipelineContext
from .runner import PipelineMiddleware, run_pipeline, stream_pipeline
from .registry import PIPELINE_REGISTRY, get_pipeline

__all__ = [
    "Phase",
    "PipelineContext",
    "PipelineMiddleware",
    "PIPELINE_REGISTRY",
    "get_phase_by_order",
    "get_pipeline",
    "parse_phase",
    "parse_phases",
    "run_pipeline",
    "stream_pipeline",
    "try_advance_phase",
]
