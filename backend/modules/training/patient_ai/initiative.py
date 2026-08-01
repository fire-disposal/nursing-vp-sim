from __future__ import annotations

"""Patient initiative runtime state and LLM generation."""

import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

from core.template import render_template
from infra.llm.client import CallContext
from infra.llm.profile import get_llm_config
from modules.training.prompts.initiative import INITIATIVE_SYSTEM, INITIATIVE_SYSTEM_SHORT
from modules.training.session.cache import InitiativeCache

log = logging.getLogger(__name__)

MAX_INITIATIVE_COUNT = 1


async def generate_initiative_llm(
    llm_client,
    personality: dict,
    vector,
    case_name: str,
    recent_student_msg: str,
    *,
    ctx: CallContext | None = None,
) -> str:
    mood = _describe_mood(vector)
    traits = _describe_traits(personality)

    llm_cfg = get_llm_config("patient_chat")

    kwargs = {
        "case_name": case_name,
        "traits": traits,
        "mood": mood,
        "trust": str(round(vector.trust * 100)),
        "comfort": str(round((1.0 - vector.anxiety * 0.5 - vector.irritation * 0.5) * 100)),
        "student_msg": recent_student_msg or "（护士在沉默）",
    }

    try:
        system = render_template(INITIATIVE_SYSTEM, **kwargs)
        result = await llm_client.call(
            [{"role": "system", "content": system}],
            purpose="patient_chat",
            ctx=ctx,
            **llm_cfg,
        )
        text = result.strip()
        if 8 <= len(text) <= 80:
            return text
    except Exception:
        log.warning("LLM initiative attempt 1 failed, retrying with simpler prompt", exc_info=True)

    try:
        system = render_template(INITIATIVE_SYSTEM_SHORT, **kwargs)
        result = await llm_client.call(
            [{"role": "system", "content": system}],
            purpose="patient_chat",
            ctx=ctx,
            **llm_cfg,
        )
        text = result.strip()
        if 5 <= len(text) <= 80:
            return text
    except Exception:
        log.warning("LLM initiative attempt 2 failed", exc_info=True)

    return _last_resort_fallback(mood)


def _last_resort_fallback(mood: str) -> str:
    fallbacks = {
        "沉默回避": "（沉默地等着）",
        "防御抵触": "（沉默地等着）",
        "焦虑不安": "[不安地挪动身体]",
        "放松配合": "不急，你慢慢问。",
        "正常": "还有什么要问的吗？",
        "开放信任": "你还有什么想了解的？",
    }
    return fallbacks.get(mood, "……")


def _describe_mood(vector) -> str:
    """从四维状态解析 mood 标签。"""
    from modules.training.patient_ai.emotion import resolve_dominant_state

    label = resolve_dominant_state(vector)
    mood_map = {
        "withdrawn": "沉默回避",
        "defensive": "防御抵触",
        "anxious_guarded": "焦虑戒备",
        "anxious_cooperative": "焦虑但配合",
        "trusting_anxious": "信任但焦虑",
        "neutral": "正常",
        "relaxed": "放松配合",
        "open_trusting": "开放信任",
        "irritated": "烦躁抵触",
    }
    return mood_map.get(label, "正常")


def _describe_traits(personality: dict) -> str:
    parts = []
    v = personality.get("verbosity", "normal")
    if v == "verbose":
        parts.append("话多健谈")
    elif v == "terse":
        parts.append("寡言少语")
    p = personality.get("patience", "normal")
    if p == "low":
        parts.append("缺乏耐心")
    elif p == "high":
        parts.append("很有耐心")
    a = personality.get("anxiety_trait", "normal")
    if a == "anxious":
        parts.append("容易紧张")
    elif a == "calm":
        parts.append("性格沉稳")
    return "性格特点：" + "，".join(parts) if parts else ""


# ── Cache-based API ──


def update_initiative_timer(record_id: int, cache: InitiativeCache, db: Session) -> None:
    now = datetime.now(UTC).timestamp()
    cache.update_timer(record_id, now, db)


def get_initiative_seconds(
    record_id: int,
    cache: InitiativeCache,
    db: Session,
    personality: dict,
    vector,
) -> tuple[float, float]:
    now = datetime.now(UTC).timestamp()
    last_reply = cache.get_timer(record_id, now, db)
    elapsed = now - last_reply

    patience = personality.get("patience", "normal")
    anxiety_trait = personality.get("anxiety_trait", "normal")
    patience_bias = {"low": -8, "normal": 0, "high": +10}
    anxiety_bias = {"anxious": -5, "normal": 0, "calm": +5}
    discomfort = (vector.anxiety * 0.5 + vector.irritation * 0.5) * 100
    discomfort_bias = max(0, discomfort - 30) * 0.3
    threshold = 30.0 + patience_bias.get(patience, 0) + anxiety_bias.get(anxiety_trait, 0) + discomfort_bias
    threshold = max(15, min(90, threshold))

    count = cache.get_count(record_id, db)
    threshold *= 2**count

    return elapsed, threshold


def check_initiate_ready(
    record_id: int,
    cache: InitiativeCache,
    db: Session,
    personality: dict,
    vector,
) -> bool:
    if cache.get_count(record_id, db) >= MAX_INITIATIVE_COUNT:
        return False
    elapsed, threshold = get_initiative_seconds(record_id, cache, db, personality, vector)
    return elapsed >= threshold


def should_initiate(
    record_id: int,
    cache: InitiativeCache,
    db: Session,
    personality: dict,
    vector,
) -> bool:
    if cache.get_count(record_id, db) >= MAX_INITIATIVE_COUNT:
        return False
    if not check_initiate_ready(record_id, cache, db, personality, vector):
        return False
    now = datetime.now(UTC).timestamp()
    last_trigger = cache.get_last_trigger(record_id, db)
    if now - last_trigger < 8:
        return False
    cache.set_last_trigger(record_id, now, db)
    return True


def apply_initiative_penalty(
    record_id: int,
    cache: InitiativeCache,
    db: Session,
) -> dict:
    from modules.training.patient_ai.emotion import EmotionDelta, EmotionRepository

    count = cache.get_count(record_id, db)
    repo = EmotionRepository()
    state = repo.get(record_id, db)

    if state is None:
        return {"state": "neutral", "trust": 50, "comfort": 50}

    if count == 1:
        delta = EmotionDelta(trust=-0.05, cooperation=-0.08, irritation=0.05)
    else:
        delta = EmotionDelta(trust=-0.15, cooperation=-0.20, irritation=0.10)

    new_vector = state.vector.apply(delta)
    repo.save(record_id, state, db)
    return {
        "state": state.vector.to_dict(),
        "trust": round(new_vector.trust * 100),
        "comfort": round((1.0 - new_vector.anxiety * 0.5 - new_vector.irritation * 0.5) * 100),
    }


def cleanup_initiative(record_id: int, cache: InitiativeCache, db: Session) -> None:
    cache.cleanup(record_id, db)
