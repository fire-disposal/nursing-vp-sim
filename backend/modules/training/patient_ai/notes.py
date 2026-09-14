"""History taking NoteSource implementations — emotion and identity guard."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from modules.training.pipeline.context import PipelineContext

from modules.training.patient_ai.note_source import NoteSource
from modules.training.pipeline.context import STATE_EMOTION_NOTE

from .guards import get_identity_correction_note, has_identity_leak

log = logging.getLogger(__name__)


class EmotionNoteSource(NoteSource):
    name = "emotion"
    priority = 10
    max_tokens = 300

    async def collect(self, ctx: PipelineContext) -> str | None:
        # 键由 pipeline.context 统一登记（写方：pipeline 的 emotion_analysis 中间件）
        cached_note = ctx.state.get(STATE_EMOTION_NOTE)
        if cached_note:
            return cached_note
        return None


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
