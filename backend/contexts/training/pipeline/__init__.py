"""Training Pipeline — composable middleware chain for message processing."""

from .builder import build_pipeline
from .context import (
    STATE_FEATURES,
    STATE_IDENTITY_CORRECTION_COUNT,
    STATE_PATIENT_CHAT_CFG,
    STATE_PATIENT_CONTEXT_KWARGS,
    STATE_PHASE_OP_COUNT,
    STATE_POST_STREAM_EVENTS,
    STATE_SAVED_MESSAGES,
    STATE_SOURCE_TRACES,
    STATE_STREAM_CHUNKS,
    STATE_STREAM_MODE,
    PipelineContext,
)
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
    "STATE_FEATURES",
    "STATE_IDENTITY_CORRECTION_COUNT",
    "STATE_PATIENT_CHAT_CFG",
    "STATE_PATIENT_CONTEXT_KWARGS",
    "STATE_PHASE_OP_COUNT",
    "STATE_POST_STREAM_EVENTS",
    "STATE_SAVED_MESSAGES",
    "STATE_SOURCE_TRACES",
    "STATE_STREAM_CHUNKS",
    "STATE_STREAM_MODE",
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
