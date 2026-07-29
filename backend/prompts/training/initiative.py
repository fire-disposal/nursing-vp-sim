from __future__ import annotations

"""患者主动追问 — 当护士沉默超过阈值时，患者根据性格/信赖/舒适/等待时长
从行为池中抽取符合人设的自然反应。"""


INITIATIVE_SYSTEM = """你正在模拟一位护理训练中的患者。
病例：{#case_name#}。{#traits#}
当前情绪状态：{#mood#}（信任度{#trust#}/100，舒适度{#comfort#}/100）。
护士沉默了一段时间没有回应。请以患者的身份主动说一句话（15-40字），
根据你的性格和情绪，可以是催促、抱怨不适、转移话题，或沉默的肢体语言（用[]标注）。
必须自然、符合当前情绪，不要重复之前已经说过的话。
只输出患者的话，不要任何解释、前缀或标签。

最近护士说：{#student_msg#}"""

INITIATIVE_SYSTEM_SHORT = """你是一位{#mood#}的患者。
病例：{#case_name#}。{#traits#}
当前情绪状态：{#mood#}（信任度{#trust#}/100，舒适度{#comfort#}/100）。
护士沉默了一段时间。请用15-30字说一句自然的追问或反应（肢体语言用[]标注）。
必须符合当前情绪与性格，不要重复之前说过的话。只输出患者的话。"""

import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

from infrastructure.llm.client import CallContext
from infrastructure.llm.profile import get_llm_config
from modules.training.session.cache import InitiativeCache
from prompts.engine import render_template

log = logging.getLogger(__name__)

MAX_INITIATIVE_COUNT = 1


async def generate_initiative_llm(
    llm_client,
    personality: dict,
    trust: int,
    comfort: int,
    case_name: str,
    recent_student_msg: str,
    *,
    ctx: CallContext | None = None,
) -> str:
    mood = _describe_mood(trust, comfort)
    traits = _describe_traits(personality)

    # 归一到 patient_chat profile（单一来源），不再硬编码参数。
    llm_cfg = get_llm_config("patient_chat")

    kwargs = {
        "case_name": case_name,
        "traits": traits,
        "mood": mood,
        "trust": str(trust),
        "comfort": str(comfort),
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


def _describe_mood(trust: int, comfort: int) -> str:
    from modules.training.patient_ai.emotion import _lookup_state

    label, _ = _lookup_state(trust, comfort)
    mood_map = {
        "withdrawn": "沉默回避",
        "defensive": "防御抵触",
        "anxious": "焦虑不安",
        "neutral": "正常",
        "relaxed": "放松配合",
        "open": "开放信任",
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
    trust: int,
    comfort: int,
) -> tuple[float, float]:
    now = datetime.now(UTC).timestamp()
    last_reply = cache.get_timer(record_id, now, db)
    elapsed = now - last_reply

    patience = personality.get("patience", "normal")
    anxiety_trait = personality.get("anxiety_trait", "normal")
    patience_bias = {"low": -8, "normal": 0, "high": +10}
    anxiety_bias = {"anxious": -5, "normal": 0, "calm": +5}
    comfort_bias = max(0, 50 - comfort) * 0.3
    threshold = 30.0 + patience_bias.get(patience, 0) + anxiety_bias.get(anxiety_trait, 0) + comfort_bias
    threshold = max(15, min(90, threshold))

    count = cache.get_count(record_id, db)
    threshold *= 2**count

    return elapsed, threshold


def check_initiate_ready(
    record_id: int,
    cache: InitiativeCache,
    db: Session,
    personality: dict,
    trust: int,
    comfort: int,
) -> bool:
    if cache.get_count(record_id, db) >= MAX_INITIATIVE_COUNT:
        return False
    elapsed, threshold = get_initiative_seconds(record_id, cache, db, personality, trust, comfort)
    return elapsed >= threshold


def should_initiate(
    record_id: int,
    cache: InitiativeCache,
    db: Session,
    personality: dict,
    trust: int,
    comfort: int,
) -> bool:
    if cache.get_count(record_id, db) >= MAX_INITIATIVE_COUNT:
        return False
    if not check_initiate_ready(record_id, cache, db, personality, trust, comfort):
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
    emotion_cache,
    db: Session,
) -> dict:
    from modules.training.patient_ai.emotion import get_emotion

    count = cache.get_count(record_id, db)
    emotion = get_emotion(record_id, emotion_cache, db)

    if count == 1:
        trust_delta = -5
        comfort_delta = -8
    else:
        trust_delta = -15
        comfort_delta = -20

    emotion.update(trust_delta, comfort_delta, f"initiative:{count}")
    emotion_cache.set(record_id, emotion, db)
    return {"state": emotion.state, "trust": emotion.trust, "comfort": emotion.comfort}


def cleanup_initiative(record_id: int, cache: InitiativeCache, db: Session) -> None:
    cache.cleanup(record_id, db)
