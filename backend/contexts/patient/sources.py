"""ContextSource — composable author_note contribution per round."""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from contexts.training.pipeline.context import PipelineContext

from contexts.patient.guard import get_identity_correction_note, has_identity_leak

log = logging.getLogger(__name__)


class ContextSource(ABC):
    name: str = ""

    @abstractmethod
    async def collect(self, ctx: "PipelineContext") -> str | None:
        ...


class EmotionNoteSource(ContextSource):
    name = "emotion"

    async def collect(self, ctx: "PipelineContext") -> str | None:
        note = ctx.state.get("emotion_note")
        return note if note else None


class IdentityGuardSource(ContextSource):
    name = "identity_guard"

    async def collect(self, ctx: "PipelineContext") -> str | None:
        last_patient = None
        for msg in reversed(ctx.messages):
            if msg.role == "patient":
                last_patient = msg.content
                break
        if last_patient and has_identity_leak(last_patient):
            return get_identity_correction_note()
        return None


class ExamResultsSource(ContextSource):
    name = "exam_results"

    async def collect(self, ctx: "PipelineContext") -> str | None:
        snapshot = ctx.record.practice_snapshot or {}
        exam_results = snapshot.get("_exam_results", [])
        if not isinstance(exam_results, list) or not exam_results:
            return None
        lines = []
        for r in exam_results[-5:]:
            label = r.get("label", "")
            value = r.get("value", "")
            unit = r.get("unit", "")
            lines.append(f"{label}: {value}{unit}")
        return "已查体征: " + " | ".join(lines)


class ExamImpactSource(ContextSource):
    name = "exam_impact"

    async def collect(self, ctx: "PipelineContext") -> str | None:
        snapshot = ctx.record.practice_snapshot or {}
        note = snapshot.get("_exam_impact_note")
        if note and isinstance(note, str) and note.strip():
            return note
        return None


_sources: list[ContextSource] = []


def register_source(source: ContextSource) -> None:
    _sources.append(source)


def get_sources() -> list[ContextSource]:
    return list(_sources)


def clear_sources() -> None:
    _sources.clear()


async def collect_author_note(ctx: "PipelineContext") -> tuple[str, list[dict]]:
    notes = []
    traces = []
    for src in get_sources():
        try:
            text = await src.collect(ctx)
        except Exception:
            log.exception("ContextSource %s failed", src.name)
            traces.append({"source": src.name, "triggered": False, "error": True})
            continue
        if text and text.strip():
            notes.append(text)
            traces.append({"source": src.name, "length": len(text), "triggered": True})
        else:
            traces.append({"source": src.name, "length": 0, "triggered": False})
    joined = "【" + " | ".join(notes) + "】" if notes else ""
    return joined, traces


register_source(EmotionNoteSource())
register_source(IdentityGuardSource())
register_source(ExamResultsSource())
register_source(ExamImpactSource())
