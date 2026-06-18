"""Pipeline infrastructure types — stages, middleware type, and ordering."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from enum import StrEnum

PipelineMiddleware = Callable[
    [object, Callable[[], Awaitable[None]]],  # (PipelineContext, next)
    Awaitable[None],
]


class PipelineStage(StrEnum):
    GUARD = "guard"
    PLUGIN_EARLY = "plugin_early"
    TRANSITION = "transition"
    PROMPT = "prompt"
    LLM = "llm"
    PERSIST = "persist"
    SIDE_EFFECTS = "side_effects"


_STAGE_ORDER: dict[PipelineStage, int] = {
    PipelineStage.GUARD: 0,
    PipelineStage.PLUGIN_EARLY: 100,
    PipelineStage.TRANSITION: 200,
    PipelineStage.PROMPT: 300,
    PipelineStage.LLM: 400,
    PipelineStage.PERSIST: 500,
    PipelineStage.SIDE_EFFECTS: 600,
}


def stage_order(stage: PipelineStage) -> int:
    return _STAGE_ORDER[stage]
