"""Training Pipeline — composable middleware chain for message processing."""

from .phase import (
    Phase,
    get_phase_by_order,
    parse_phase,
    parse_phases,
    try_advance_phase,
)
from .context import PipelineContext

__all__ = [
    "Phase",
    "PipelineContext",
    "get_phase_by_order",
    "parse_phase",
    "parse_phases",
    "try_advance_phase",
]
