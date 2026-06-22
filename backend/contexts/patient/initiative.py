"""患者主动行为引擎 — 非语言线索 + 自发话语

当护士沉默超过阈值时，患者根据性格/信赖/舒适/等待时长
从行为池中抽取符合人设的自然反应。
"""

from __future__ import annotations

import logging
import random
from datetime import UTC, datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

from infrastructure.cache import InitiativeCache
from infrastructure.llm.client import CallContext

log = logging.getLogger(__name__)

_NONVERBAL_CUES = [
    "[叹气]",
    "[不安地挪动身体]",
    "[低头看手机]",
    "[轻轻咳嗽]",
    "[揉着疼痛的部位]",
    "[紧张地搓手]",
    "[看了看门口]",
    "[深呼吸，试图让自己平静]",
    "[擦了擦额头的汗]",
    "[皱起眉头]",
]

_ANXIOUS_PROMPTS = [
    "护士……我这情况严重吗？",
    "护士，我有点害怕……我会不会有什么事啊？",
    "护士，我家里人还不知道我来医院……",
    "我这个得住院吗？得住多久啊？",
    "护士你是不是发现什么不好的了？怎么不说话了？",
]

_NEUTRAL_PROMPTS = [
    "护士你还在记吗？",
    "（等了一会儿）你还需要我补充什么吗？",
    "我刚才说的那些……有用吗？",
    "还有什么要问的吗？我尽量配合。",
]

_IMPATIENT_PROMPTS = [
    "护士，能不能快点？我有点着急……",
    "怎么问来问去的……我这到底什么情况啊？",
    "护士你再不说话我可走了啊……",
    "我就想知道我这什么毛病，怎么这么费劲呢？",
]

_CALM_PROMPTS = [
    "不急，你慢慢问。",
    "没事，你仔细想，我等一会儿。",
    "（安静地等着，习惯了这种节奏）",
]

_VERBOSE_EXTRAS = [
    "对了，我还想起一件事……",
    "其实之前有一次也差不多这样，那次是……",
    "我跟你说，我家老伴儿比我还着急……",
    "我这个情况啊，说来话长……",
]


def generate_initiative(
    personality: dict,
    trust: int,
    comfort: int,
    wait_seconds: float,
) -> str | None:
    """Rule-based initiative text generation (fallback)."""
    verbosity = personality.get("verbosity", "normal")
    patience = personality.get("patience", "normal")
    anxiety_trait = personality.get("anxiety_trait", "normal")

    base_threshold = 30.0
    patience_bias = {"low": -8, "normal": 0, "high": +10}
    anxiety_bias = {"anxious": -5, "normal": 0, "calm": +5}
    comfort_bias = max(0, 50 - comfort) * 0.3

    threshold = base_threshold + patience_bias.get(patience, 0) + anxiety_bias.get(anxiety_trait, 0) + comfort_bias
    threshold = max(15, min(90, threshold))

    if wait_seconds < threshold:
        return None

    roll = random.random()

    if comfort <= 30:
        if roll < 0.6:
            return random.choice(_NONVERBAL_CUES)
        if roll < 0.85:
            return random.choice(_ANXIOUS_PROMPTS)
        return random.choice(_IMPATIENT_PROMPTS)

    if trust <= 40:
        if roll < 0.5:
            return random.choice(_IMPATIENT_PROMPTS)
        if roll < 0.75:
            return random.choice(_NONVERBAL_CUES)
        return random.choice(_NEUTRAL_PROMPTS)

    if comfort >= 60:
        if roll < 0.3:
            return random.choice(_NONVERBAL_CUES)
        if verbosity == "verbose" and roll < 0.6:
            return random.choice(_VERBOSE_EXTRAS)
        if patience == "high" and roll < 0.75:
            return random.choice(_CALM_PROMPTS)
        return random.choice(_NEUTRAL_PROMPTS)

    if roll < 0.3:
        return random.choice(_NONVERBAL_CUES)
    if verbosity == "verbose" and roll < 0.5:
        return random.choice(_VERBOSE_EXTRAS)
    return random.choice(_NEUTRAL_PROMPTS)


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
    """LLM-driven initiative text — generates a natural, context-aware patient utterance."""
    try:
        mood = _describe_mood(trust, comfort)
        traits = _describe_traits(personality)
        prompt = [
            {
                "role": "system",
                "content": (
                    f"你正在模拟一位护理训练中的患者。病例：{case_name}。{traits}\n"
                    f"当前情绪状态：{mood}（信任{trust}/100，舒适{comfort}/100）。\n"
                    "护士刚刚说了一句话但你没有立即回复。请以患者的身份说一句简短、自然的追问或反应（≤30字），"
                    "可以是催促、补充信息、表达不适、转移话题或沉默的肢体语言。"
                    "只输出患者的话，不要任何解释或标签。"
                ),
            },
            {"role": "user", "content": f"护士说：{recent_student_msg}"},
        ]
        result = await llm_client.call(
            prompt,
            purpose="patient_chat",
            temperature=0.8,
            max_tokens=60,
            timeout=10,
            max_retries=0,
            ctx=ctx,
        )
        text = result.strip()
        if 2 <= len(text) <= 80:
            return text
    except Exception:
        pass
    return random.choice(_NEUTRAL_PROMPTS)


def _describe_mood(trust: int, comfort: int) -> str:
    if comfort <= 30:
        return "焦虑不安"
    if trust <= 40:
        return "防御抵触"
    if comfort >= 60:
        return "放松配合"
    return "正常"


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

    return elapsed, threshold


def check_initiate_ready(
    record_id: int,
    cache: InitiativeCache,
    db: Session,
    personality: dict,
    trust: int,
    comfort: int,
) -> bool:
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
    if not check_initiate_ready(record_id, cache, db, personality, trust, comfort):
        return False
    now = datetime.now(UTC).timestamp()
    last_trigger = cache.get_last_trigger(record_id, db)
    if now - last_trigger < 8:
        return False
    cache.set_last_trigger(record_id, now, db)
    return True


def cleanup_initiative(record_id: int, cache: InitiativeCache, db: Session) -> None:
    cache.cleanup(record_id, db)
