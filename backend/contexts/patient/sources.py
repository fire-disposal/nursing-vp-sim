"""ContextSource implementations — composable author_note contributions per round.

NoteSources are now assembled by NoteCollector at pipeline build time,
not registered globally. See note_collector.py and plugins/manager.py.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from contexts.training.pipeline.context import PipelineContext

from contexts.patient.guards import get_identity_correction_note, has_identity_leak

log = logging.getLogger(__name__)


class ContextSource(ABC):
    name: str = ""

    @abstractmethod
    async def collect(self, ctx: "PipelineContext") -> str | None: ...


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


class ExamImpactSource(ContextSource):
    name = "exam_impact"

    async def collect(self, ctx: "PipelineContext") -> str | None:
        rs = ctx.record.runtime_state or {}
        note = rs.get("exam_impact_note")
        if note and isinstance(note, str) and note.strip():
            return note
        return None


class PluginAuthorNoteSource(ContextSource):
    name = "plugin_author_notes"

    async def collect(self, ctx: "PipelineContext") -> str | None:
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


