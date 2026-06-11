"""患者主动行为引擎 — 非语言线索 + 自发话语

当护士沉默超过阈值时，患者根据性格/信赖/舒适/等待时长
从行为池中抽取符合人设的自然反应。
"""

from __future__ import annotations

import logging
import random
from datetime import UTC, datetime

from infrastructure.cache import InitiativeCache

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
    verbosity = personality.get("verbosity", "normal")
    patience = personality.get("patience", "normal")
    anxiety_trait = personality.get("anxiety_trait", "normal")

    base_threshold = 30.0
    patience_bias = {"low": -8, "normal": 0, "high": +10}
    anxiety_bias = {"anxious": -5, "normal": 0, "calm": +5}
    comfort_bias = max(0, 50 - comfort) * 0.3  # 舒适越低越早触发

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


# ── Cache-based API ──


def update_initiative_timer(record_id: int, cache: InitiativeCache, last_reply_length: int = 0) -> None:
    now = datetime.now(UTC).timestamp()
    cache.update_timer(record_id, now)


def get_initiative_seconds(
    record_id: int,
    cache: InitiativeCache,
    personality: dict,
    trust: int,
    comfort: int,
) -> tuple[float, float]:
    now = datetime.now(UTC).timestamp()
    last_reply = cache.get_timer(record_id, now)
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
    personality: dict,
    trust: int,
    comfort: int,
) -> bool:
    elapsed, threshold = get_initiative_seconds(record_id, cache, personality, trust, comfort)
    return elapsed >= threshold


def should_initiate(
    record_id: int,
    cache: InitiativeCache,
    personality: dict,
    trust: int,
    comfort: int,
) -> bool:
    if not check_initiate_ready(record_id, cache, personality, trust, comfort):
        return False
    now = datetime.now(UTC).timestamp()
    last_trigger = cache.get_last_trigger(record_id)
    if now - last_trigger < 8:
        return False
    cache.set_last_trigger(record_id, now)
    return True


def cleanup_initiative(record_id: int, cache: InitiativeCache) -> None:
    cache.cleanup(record_id)
