"""Plugin system — declarative protocol for training functionality."""

from .base import (
    EndContext,
    ExamContext,
    ExamEffect,
    PipelineStage,
    Plugin,
    RecordCreateContext,
    RouteDef,
)

__all__ = [
    "EndContext",
    "ExamContext",
    "ExamEffect",
    "PipelineStage",
    "Plugin",
    "RecordCreateContext",
    "RouteDef",
]
