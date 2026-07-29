"""side_effects — post-reply effects: emotion state emission (immediate) + analysis (background)."""

import asyncio
import json
import logging

from infra.llm.client import CallContext
from modules.training.patient_ai.emotion import EmotionState, get_emotion
from profiles.history_taking.emotion_profile import PersonalityProfile
from prompts import render_template
from prompts.training.emotion import EMOTION_ANALYSIS_SYSTEM, EMOTION_ANALYSIS_USER
from prompts.training.initiative import MAX_INITIATIVE_COUNT, get_initiative_seconds

from ..context import (
    STATE_FEATURES,
    PipelineContext,
)

log = logging.getLogger(__name__)


def _parse_emotion_result(raw: str) -> tuple[int, int, str]:
    try:
        data = json.loads(raw.strip())
        dt = max(-3, min(3, int(data.get("trust_delta", 0))))
        dc = max(-3, min(3, int(data.get("comfort_delta", 0))))
        trigger = str(data.get("trigger", ""))
        return dt, dc, trigger
    except (json.JSONDecodeError, ValueError, TypeError):
        log.warning("Failed to parse emotion analysis result: %s", raw[:200])
        return 0, 0, ""


def _read_emotion_state(record_id: int, emotion_cache, db, personality: dict):
    """Return current emotion state without creating/updating rows."""
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


async def _analyze_and_apply(
    llm_client,
    emotion_cache,
    record_id: int,
    user_id: int,
    case_id: int,
    student_input: str,
    patient_reply: str,
    personality: dict,
) -> None:
    """Background task: analyze this turn's reply and apply delta for the next turn."""
    try:
        user_msg = render_template(
            EMOTION_ANALYSIS_USER,
            nurse_message=student_input,
            patient_reply=patient_reply,
        )
        messages = [
            {"role": "system", "content": EMOTION_ANALYSIS_SYSTEM},
            {"role": "user", "content": user_msg},
        ]
        result = await llm_client.call(
            messages,
            purpose="emotion_analysis",
            ctx=CallContext(
                purpose="emotion_analysis",
                user_id=user_id,
                record_id=record_id,
                case_id=case_id,
            ),
            temperature=0.3,
            max_tokens=128,
        )
        dt, dc, trigger = _parse_emotion_result(result)
    except Exception:
        log.warning("Emotion analysis failed: record_id=%d", record_id, exc_info=True)
        return

    if dt == 0 and dc == 0 and not trigger:
        return

    from core.database import SessionLocal

    db = SessionLocal()
    try:
        profile = PersonalityProfile.from_personality(personality)
        emotion = get_emotion(record_id, emotion_cache, db, profile=profile)
        emotion.update(dt, dc, trigger)
        emotion_cache.set(record_id, emotion, db)
        db.commit()
    except Exception:
        db.rollback()
        log.warning("Emotion background apply failed: record_id=%d", record_id, exc_info=True)
    finally:
        db.close()


async def side_effects(ctx: PipelineContext, next_mw) -> None:
    await next_mw()

    if ctx.error or ctx.should_shortcut:
        return

    app = ctx.app_state
    features = ctx.state.get(STATE_FEATURES) or {}

    has_emotion = features.get("emotion", False)

    if has_emotion and ctx.llm_reply:
        emotion_cache = getattr(app, "emotion_cache", None)
        if emotion_cache is None:
            return
        case_data = ctx.case_data or {}
        personality = case_data.get("personality", {}) or {}
        emotion = _read_emotion_state(ctx.record.id, emotion_cache, ctx.db, personality)
        emotion.apply_decay()

        ctx.system_events.append(
            {
                "emotion_change": {
                    "state": emotion.state,
                    "trust": emotion.trust,
                    "comfort": emotion.comfort,
                }
            }
        )

        task = asyncio.ensure_future(  # noqa: RUF006
            _analyze_and_apply(
                llm_client=app.llm_client,
                emotion_cache=emotion_cache,
                record_id=ctx.record.id,
                user_id=ctx.current_user.id,
                case_id=ctx.record.case_id,
                student_input=ctx.student_input,
                patient_reply=ctx.llm_reply,
                personality=personality,
            )
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
                emotion_cache = getattr(app, "emotion_cache", None)
                emotion_state = _read_emotion_state(ctx.record.id, emotion_cache, ctx.db, personality)

                elapsed, threshold = get_initiative_seconds(
                    ctx.record.id, initiative_cache, ctx.db, personality, emotion_state.trust, emotion_state.comfort
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
