"""Plugin system — declarative protocol for training functionality."""

from .base import (
    EndContext,
    ExamContext,
    ExamEffect,
    PhaseChangeContext,
    PipelineStage,
    Plugin,
    RecordCreateContext,
    RouteDef,
    ScoreContext,
)

__all__ = [
    "EndContext",
    "ExamContext",
    "ExamEffect",
    "PhaseChangeContext",
    "PipelineStage",
    "Plugin",
    "RecordCreateContext",
    "RouteDef",
    "ScoreContext",
]
