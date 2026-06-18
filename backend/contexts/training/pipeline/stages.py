"""Pipeline stages — stage enum, ordering, and middleware type alias."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from enum import StrEnum

from .context import PipelineContext

PipelineMiddleware = Callable[
    [PipelineContext, Callable[[], Awaitable[None]]],
    Awaitable[None],
]


class PipelineStage(StrEnum):
    GUARD = "guard"
    TRANSITION = "transition"
    PROMPT = "prompt"
    LLM = "llm"
    PERSIST = "persist"
    SIDE_EFFECTS = "side_effects"


_STAGE_ORDER: dict[PipelineStage, int] = {
    PipelineStage.GUARD: 0,
    PipelineStage.TRANSITION: 100,
    PipelineStage.PROMPT: 200,
    PipelineStage.LLM: 300,
    PipelineStage.PERSIST: 400,
    PipelineStage.SIDE_EFFECTS: 500,
}


def stage_order(stage: PipelineStage) -> int:
    return _STAGE_ORDER[stage]
