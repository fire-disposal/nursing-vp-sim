"""side_effects — post-reply effects: emotion state push (immediate), initiative state."""

import logging

from modules.training.patient_ai.initiative import MAX_INITIATIVE_COUNT, get_initiative_seconds

from ..context import (
    STATE_FEATURES,
    PipelineContext,
)

log = logging.getLogger(__name__)


def _read_emotion_state(record_id: int, emotion_cache, db, personality: dict):
    """Return current emotion state from cache (v2 format)."""
    from modules.training.patient_ai.emotion._legacy import EmotionState
    from modules.training.patient_ai.emotion_profile import PersonalityProfile

    profile = PersonalityProfile.from_personality(personality)
    state = None
    if emotion_cache is not None:
        try:
            state = emotion_cache.get(record_id, db)
        except Exception:
            log.warning("Emotion state read failed: record_id=%d", record_id, exc_info=True)
    if isinstance(state, EmotionState):
        if state.profile.trust_base == 50 and profile.trust_base != 50:
            state.profile = profile
        return state
    return EmotionState(trust=profile.trust_base, comfort=profile.comfort_base, profile=profile)


async def side_effects(ctx: PipelineContext, next_mw) -> None:
    await next_mw()

    if ctx.error or ctx.should_shortcut:
        return

    app = ctx.app_state
    features = ctx.state.get(STATE_FEATURES) or {}

    has_emotion = features.get("emotion", False)
    if has_emotion and ctx.llm_reply:
        # 推送 4D emotion_change
        change_4d = ctx.state.get("_emotion_change")
        dominant = ctx.state.get("_emotion_dominant")
        if change_4d and dominant:
            ctx.system_events.append(
                {
                    "emotion_change": {
                        **change_4d,
                        "dominant_state": dominant,
                    }
                }
            )
    has_initiative = features.get("patient_initiative", False)

    if has_initiative and ctx.llm_reply:
        initiative_cache = getattr(app, "initiative_cache", None)
        if initiative_cache is not None:
            try:
                case_data = ctx.case_data or {}
                personality = case_data.get("personality", {}) or case_data.get("patient_info", {}).get(
                    "personality", {}
                )
                from modules.training.patient_ai.emotion import EmotionRepository, EmotionVector

                repo = EmotionRepository()
                state = repo.get(ctx.record.id, ctx.db)
                vector = state.vector if state else EmotionVector.neutral()

                elapsed, threshold = get_initiative_seconds(
                    ctx.record.id, initiative_cache, ctx.db, personality, vector
                )
                count = initiative_cache.get_count(ctx.record.id, ctx.db)
                max_reached = count >= MAX_INITIATIVE_COUNT
                ctx.system_events.append(
                    {
                        "initiative_state": {
                            "elapsed_seconds": round(elapsed, 1),
                            "threshold_seconds": round(threshold, 1),
                            "percent": min(100, round(elapsed / max(1, threshold) * 100, 1)),
                            "initiative_count": count,
                            "max_reached": max_reached,
                        }
                    }
                )
            except Exception:
                log.warning("Initiative state emission failed: record_id=%d", ctx.record.id, exc_info=True)

    try:
        ctx.db.commit()
    except Exception:
        ctx.db.rollback()
        log.warning("Side effects commit failed: record_id=%d", ctx.record.id, exc_info=True)
