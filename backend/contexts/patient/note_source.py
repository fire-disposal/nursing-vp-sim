"""NoteSource — per-round context injection sources."""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from contexts.training.pipeline.context import PipelineContext

from contexts.patient.guards import get_identity_correction_note, has_identity_leak

log = logging.getLogger(__name__)


class NoteSource(ABC):
    name: str = ""
    priority: int = 0
    max_tokens: int = 100

    @abstractmethod
    async def collect(self, ctx: PipelineContext) -> str | None:
        ...


class EmotionNoteSource(NoteSource):
    name = "emotion"
    priority = 10
    max_tokens = 100

    async def collect(self, ctx: PipelineContext) -> str | None:
        note = ctx.state.get("emotion_note")
        return note if note else None


class IdentityGuardSource(NoteSource):
    name = "identity_guard"
    priority = 20
    max_tokens = 50

    async def collect(self, ctx: PipelineContext) -> str | None:
        last_patient = None
        for msg in reversed(ctx.messages):
            if msg.role == "patient":
                last_patient = msg.content
                break
        if last_patient and has_identity_leak(last_patient):
            return get_identity_correction_note()
        return None


class ExamResultsSource(NoteSource):
    name = "exam_results"
    priority = 30
    max_tokens = 200

    async def collect(self, ctx: PipelineContext) -> str | None:
        rs = ctx.record.runtime_state or {}
        exam_results = rs.get("exam_results", [])
        if not isinstance(exam_results, list) or not exam_results:
            return None
        lines = []
        for r in exam_results[-5:]:
            label = r.get("label", "")
            value = r.get("value", "")
            unit = r.get("unit", "")
            lines.append(f"{label}: {value}{unit}")
        return "已查体征: " + " | ".join(lines)


class ExamImpactSource(NoteSource):
    name = "exam_impact"
    priority = 40
    max_tokens = 100

    async def collect(self, ctx: PipelineContext) -> str | None:
        rs = ctx.record.runtime_state or {}
        note = rs.get("exam_impact_note")
        if note and isinstance(note, str) and note.strip():
            return note
        return None


class PluginAuthorNoteSource(NoteSource):
    name = "plugin_author_notes"
    priority = 50
    max_tokens = 300

    async def collect(self, ctx: PipelineContext) -> str | None:
        try:
            from plugins.manager import get_plugin_manager
        except ImportError:
            log.debug("PluginManager not available")
            return None

        pm = get_plugin_manager()
        features = ctx.state.get("features") or {}
        plugins = pm.get_active(features)

        notes = []
        for plugin in plugins:
            try:
                note = plugin.author_note(ctx)
                if note and note.strip():
                    notes.append(note)
            except Exception:
                log.exception("Plugin %s author_note() failed", plugin.id)
        return " | ".join(notes) if notes else None
