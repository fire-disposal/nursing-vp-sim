"""History taking NoteSource implementations — emotion and identity guard."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from modules.training.pipeline.context import PipelineContext

from modules.training.patient_ai.note_source import NoteSource

from .guards import get_identity_correction_note, has_identity_leak

log = logging.getLogger(__name__)


class EmotionNoteSource(NoteSource):
    name = "emotion"
    priority = 10
    max_tokens = 100

    async def collect(self, ctx: PipelineContext) -> str | None:
        from profiles.history_taking.emotion_profile import PersonalityProfile

        from .emotion import get_emotion

        cache = getattr(ctx.app_state, "emotion_cache", None)
        if cache is None:
            return None
        case_data = getattr(ctx, "case_data", None) or {}
        personality = case_data.get("personality", {}) or {}
        profile = PersonalityProfile.from_personality(personality)
        emotion = get_emotion(ctx.record.id, cache, ctx.db, profile=profile)
        return emotion.note


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
