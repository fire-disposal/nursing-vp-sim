"""Plugin base class and supporting types."""

from __future__ import annotations

from abc import ABC
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, ClassVar

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


@dataclass
class RouteDef:
    method: str
    path: str
    handler: Callable
    response_model: type | None = None
    tags: list[str] = field(default_factory=lambda: ["plugin"])


@dataclass
class RecordCreateContext:
    record: Any  # TrainingRecord
    emotion_cache: Any  # EmotionCache
    initiative_cache: Any  # InitiativeCache


@dataclass
class ExamContext:
    record: Any  # TrainingRecord
    emotion_cache: Any  # EmotionCache
    op_type: str
    explanation_given: bool
    exam_count: int


@dataclass
class ExamEffect:
    snapshot_updates: dict = field(default_factory=dict)
    emotion_delta: tuple[int, int] | None = None
    history_event: dict | None = None


@dataclass
class EndContext:
    record: Any  # TrainingRecord
    emotion_cache: Any  # EmotionCache
    initiative_cache: Any  # InitiativeCache


@dataclass
class UIManifest:
    type: str  # "panel" | "overlay"
    tab: dict | None = None
    actions: list[dict] = field(default_factory=list)


class Plugin(ABC):
    id: ClassVar[str]
    name: ClassVar[str]
    description: ClassVar[str] = ""
    requires: ClassVar[list[str]] = []
    feature_flag: ClassVar[Any] = None  # FeatureFlag | None

    def get_middleware(self) -> list[tuple[PipelineStage, PipelineMiddleware]]:
        return []

    def get_routes(self) -> list[RouteDef]:
        return []

    async def on_record_create(self, ctx: RecordCreateContext) -> None:
        return

    async def on_exam(self, ctx: ExamContext) -> ExamEffect | None:
        return None

    async def on_training_end(self, ctx: EndContext) -> None:
        return

    def ui_manifest(self) -> UIManifest | None:
        return None

    def author_note(self, ctx: Any) -> str | None:
        return None

    def get_note_sources(self) -> list:
        return []
