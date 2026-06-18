"""Training Pipeline — composable middleware chain for message processing."""

from .builder import build_pipeline
from .context import PipelineContext
from .phase import (
    Phase,
    get_phase_by_order,
    parse_phase,
    parse_phases,
    try_advance_phase,
)
from .registry import get_pipeline
from .runner import run_pipeline, stream_pipeline
from .stages import PipelineMiddleware, PipelineStage, stage_order

__all__ = [
    "Phase",
    "PipelineContext",
    "PipelineMiddleware",
    "PipelineStage",
    "build_pipeline",
    "get_phase_by_order",
    "get_pipeline",
    "parse_phase",
    "parse_phases",
    "run_pipeline",
    "stage_order",
    "stream_pipeline",
    "try_advance_phase",
]
