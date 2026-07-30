"""emotion_analysis — inline emotion analysis before patient generation.

Runs BEFORE prompt_builder so the current student's communication behavior
affects the current patient reply, not the next one.

Flow:
    1. Read current emotion state from cache
    2. Analyze student input via EmotionAnalyzer (LLM)
    3. Recover + apply events via EmotionEngine
    4. Save updated state to cache
    5. Derive behavior policy → store in ctx.state for prompt_builder + side_effects
"""

from __future__ import annotations

import logging

from modules.training.patient_ai.emotion import (
    EmotionAnalyzer,
    EmotionEngine,
    EmotionProfile,
    EmoState,
    derive_behavior,
    render_behavior_note,
    resolve_dominant_state,
)
from modules.training.pipeline.context import PipelineContext

log = logging.getLogger(__name__)

# ctx.state keys
STATE_EMOTION_NOTE: str = "_emotion_note"
STATE_EMOTION_CHANGE: str = "_emotion_change"
STATE_EMOTION_DOMINANT: str = "_emotion_dominant"


async def emotion_analysis(ctx: PipelineContext, next_mw) -> None:
    """Analyze student input, update emotion state, and prepare behavior note.

    Stores results in ctx.state for downstream middleware.
    """
    if ctx.should_shortcut:
        await next_mw()
        return

    features = ctx.state.get("features") or {}
    if not features.get("emotion", False):
        await next_mw()
        return

    app = ctx.app_state
    emotion_cache = getattr(app, "emotion_cache", None)
    if emotion_cache is None:
        await next_mw()
        return

    case_data = getattr(ctx, "case_data", None) or {}
    personality = case_data.get("personality", {}) or {}

    try:
        # 1. Build profile
        profile = EmotionProfile.from_personality(personality)

        # 2. Read current state from cache (old v2 format for now)
        from modules.training.patient_ai.emotion._legacy import EmotionState, get_emotion

        old_state = get_emotion(ctx.record.id, emotion_cache, ctx.db, profile=None)  # type: ignore[arg-type]
        old_trust = old_state.trust / 100.0
        old_comfort = old_state.comfort / 100.0

        # 3. Map old 2D → new 4D (approximate)
        from modules.training.patient_ai.emotion import EmotionVector, EmoState as NewState

        vector = EmotionVector(
            trust=old_trust,
            anxiety=clamp01(1.0 - old_comfort),
            irritation=clamp01(0.5 - old_trust * 0.3 - old_comfort * 0.2),
            cooperation=clamp01(0.35 + old_trust * 0.4 + old_comfort * 0.25),
        )

        # 4. Recover toward baseline
        engine = EmotionEngine()
        vector = engine.recover(vector, profile)

        # 5. Analyze student input
        student_text = ctx.student_display or ctx.student_input
        patient_text = ""
        for msg in reversed(ctx.messages):
            if msg.role == "patient":
                patient_text = msg.content or ""
                break

        analyzer = EmotionAnalyzer(app.llm_client)
        result = await analyzer.analyze(
            nurse_message=student_text,
            patient_reply=patient_text,
            user_id=ctx.current_user.id,
            record_id=ctx.record.id,
            case_id=ctx.record.case_id,
        )

        # 6. Apply events
        if result.events:
            state = NewState(vector=vector, version=1)
            new_state, applied_events = engine.apply_events(state, profile, result.events)
            vector = new_state.vector
            log.debug(
                "Emotion events applied: %d events, counts=%s",
                len(applied_events),
                {e.type.value: 1 for e in applied_events},
            )

        # 7. Map back to old 2D format and save
        new_trust = int(clamp01(vector.trust) * 100)
        new_comfort = int(clamp01(1.0 - vector.anxiety * 0.6 - vector.irritation * 0.4) * 100)

        old_state.trust = new_trust
        old_state.comfort = new_comfort
        emotion_cache.set(ctx.record.id, old_state, ctx.db)

        # 8. Derive behavior policy + note
        policy = derive_behavior(vector)
        note = render_behavior_note(policy)
        dominant = resolve_dominant_state(vector)

        ctx.state[STATE_EMOTION_NOTE] = note
        ctx.state[STATE_EMOTION_CHANGE] = {
            "trust": round(vector.trust, 2),
            "anxiety": round(vector.anxiety, 2),
            "irritation": round(vector.irritation, 2),
            "cooperation": round(vector.cooperation, 2),
        }
        ctx.state[STATE_EMOTION_DOMINANT] = dominant

    except Exception:
        log.warning("Emotion analysis failed: record_id=%d", ctx.record.id, exc_info=True)

    await next_mw()


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))
