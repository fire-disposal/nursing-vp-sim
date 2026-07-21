"""side_effects — post-reply effects including emotion analysis and initiative state emission."""

import json
import logging
import re

from profiles.history_taking.emotion import get_emotion
from profiles.history_taking.emotion_profile import PersonalityProfile
from profiles.history_taking.initiative import MAX_INITIATIVE_COUNT, get_initiative_seconds

from ..context import (
    STATE_FEATURES,
    PipelineContext,
)

log = logging.getLogger(__name__)

_EMOTION_DELTA_RE = re.compile(r'"emotion"\s*:\s*\{[^}]*\}')
MAX_DELTA = 3


def _extract_emotion_delta(llm_reply: str) -> tuple[int, int, str]:
    """Extract structured emotion delta from LLM reply. Returns (trust_delta, comfort_delta, trigger).

    Searches the reply for a JSON block containing an "emotion" key.
    Falls back to (0, 0, "") on parse failure.
    """
    matches = _EMOTION_DELTA_RE.findall(llm_reply)
    for match in matches:
        try:
            parsed = json.loads("{" + match + "}")
            emotion = parsed.get("emotion", {})
            dt = max(-MAX_DELTA, min(MAX_DELTA, int(emotion.get("trust_delta", 0))))
            dc = max(-MAX_DELTA, min(MAX_DELTA, int(emotion.get("comfort_delta", 0))))
            trigger = str(emotion.get("trigger", ""))
            return dt, dc, trigger
        except (json.JSONDecodeError, ValueError, TypeError):
            continue
    return 0, 0, ""


async def side_effects(ctx: PipelineContext, next_mw) -> None:
    await next_mw()

    if ctx.error or ctx.should_shortcut:
        return

    app = ctx.app_state
    features = ctx.state.get(STATE_FEATURES) or {}

    # 单一真相：仅从解析后的 features 门控（emotion 为 builtin 恒开；见 core.capabilities）
    has_emotion = features.get("emotion", False)

    if has_emotion and ctx.llm_reply:
        emotion_cache = getattr(app, "emotion_cache", None)
        if emotion_cache is None:
            return
        case_data = ctx.case_data or {}
        personality = case_data.get("personality", {}) or {}
        profile = PersonalityProfile.from_personality(personality)
        emotion = get_emotion(ctx.record.id, emotion_cache, ctx.db, profile=profile)
        emotion.apply_decay()

        dt, dc, trigger = _extract_emotion_delta(ctx.llm_reply)

        if dt != 0 or dc != 0:
            emotion.update(dt, dc, trigger)
            emotion_cache.set(ctx.record.id, emotion, ctx.db)
            ctx.system_events.append(
                {
                    "emotion_change": {
                        "state": emotion.state,
                        "trust": emotion.trust,
                        "comfort": emotion.comfort,
                    }
                }
            )

    # 单一真相：自动主动发言与手动/计时器路径统一门控于 feature（修复此前 has_initiative 造成的端到端断裂）
    has_initiative = features.get("patient_initiative", False)
    if not has_initiative or not ctx.llm_reply:
        return

    initiative_cache = getattr(app, "initiative_cache", None)
    if initiative_cache is None:
        return

    try:
        emotion_state = get_emotion(ctx.record.id, app.emotion_cache, ctx.db)
        case_data = ctx.case_data or {}
        personality = case_data.get("personality", {}) or case_data.get("patient_info", {}).get("personality", {})

        # Emit initiative state for frontend polling bar
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

    ctx.db.commit()
