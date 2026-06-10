"""患者主动行为引擎 — 非语言线索 + 自发话语

当护士沉默超过阈值时，患者不再是简单催促，而是根据性格/情绪/等待时长
从行为池中抽取符合人设的自然反应。借鉴 AI酒館 的"内在驱动力"理念。
"""

import logging
import random
from datetime import UTC, datetime

log = logging.getLogger(__name__)

# 非语言线索（短小精悍，带方括号）
_NONVERBAL_CUES = [
    "[叹气]", "[不安地挪动身体]", "[低头看手机]",
    "[轻轻咳嗽]", "[揉着疼痛的部位]", "[紧张地搓手]",
    "[看了看门口]", "[深呼吸，试图让自己平静]",
    "[擦了擦额头的汗]", "[皱起眉头]",
]

# ── 主动话语池（按情绪分桶）──

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

# ── 行为池入口 ──

def generate_initiative(
    personality: dict,
    emotion_score: int,
    emotion_state: str,
    wait_seconds: float,
) -> str | None:
    """根据患者状态生成一次主动行为。返回 None 表示还没到触发时机。

    personality: {health_literacy, verbosity, anxiety_trait, patience}
    emotion_score: -2 ~ 2
    wait_seconds: 距离上次回复的秒数
    """
    verbosity = personality.get("verbosity", "normal")
    patience = personality.get("patience", "normal")
    anxiety_trait = personality.get("anxiety_trait", "normal")

    # ── 触发阈值（根据性格调整）──
    base_threshold = 30.0  # 基础静默阈值（秒）

    patience_bias = {"low": -8, "normal": 0, "high": +10}
    anxiety_bias = {"anxious": -5, "normal": 0, "calm": +5}
    emotion_bias = emotion_score * -3  # 情绪越负面，越早触发

    threshold = base_threshold + patience_bias.get(patience, 0) + anxiety_bias.get(anxiety_trait, 0) + emotion_bias
    threshold = max(15, min(90, threshold))  # 夹在 15-90 秒

    if wait_seconds < threshold:
        return None

    # ── 根据情绪状态选择行为类型 ──
    roll = random.random()

    if emotion_state in ("withdrawn", "defensive"):
        # 防御/沉默 → 大部分是非语言线索，偶尔简短催促
        if roll < 0.6:
            return random.choice(_NONVERBAL_CUES)
        elif roll < 0.85:
            return random.choice(_ANXIOUS_PROMPTS)
        else:
            return random.choice(_IMPATIENT_PROMPTS)

    if emotion_score <= -1:
        # 负面情绪 → 焦虑催促为主
        if roll < 0.5:
            return random.choice(_ANXIOUS_PROMPTS)
        elif roll < 0.75:
            return random.choice(_NONVERBAL_CUES)
        else:
            return random.choice(_IMPATIENT_PROMPTS)

    if emotion_score >= 1:
        # 放松/开放 → 非语言线索 + 闲聊
        if roll < 0.3:
            return random.choice(_NONVERBAL_CUES)
        elif verbosity == "verbose" and roll < 0.6:
            return random.choice(_VERBOSE_EXTRAS)
        elif patience == "high" and roll < 0.75:
            return random.choice(_CALM_PROMPTS)
        else:
            return random.choice(_NEUTRAL_PROMPTS)

    # neutral → 普通催促
    if roll < 0.3:
        return random.choice(_NONVERBAL_CUES)
    elif verbosity == "verbose" and roll < 0.5:
        return random.choice(_VERBOSE_EXTRAS)
    else:
        return random.choice(_NEUTRAL_PROMPTS)


# ── 会话级别的触发计时器 ──
_initiative_timers: dict[int, float] = {}
_last_trigger_time: dict[int, float] = {}


def update_initiative_timer(record_id: int, last_reply_length: int = 0):
    """每次收到患者回复后调用，重置计时器。"""
    now = datetime.now(UTC).timestamp()
    _initiative_timers[record_id] = now
    _last_trigger_time.pop(record_id, None)


def get_initiative_seconds(record_id: int, personality: dict, emotion_score: int) -> tuple[float, float]:
    """返回 (已等待秒数, 触发阈值秒数)。

    调试 UI 用：当前计时 / 触发阈值。
    """
    now = datetime.now(UTC).timestamp()
    last_reply = _initiative_timers.get(record_id, now)
    elapsed = now - last_reply

    patience = personality.get("patience", "normal")
    anxiety_trait = personality.get("anxiety_trait", "normal")
    patience_bias = {"low": -8, "normal": 0, "high": +10}
    anxiety_bias = {"anxious": -5, "normal": 0, "calm": +5}
    emotion_bias = emotion_score * -3
    threshold = 30.0 + patience_bias.get(patience, 0) + anxiety_bias.get(anxiety_trait, 0) + emotion_bias
    threshold = max(15, min(90, threshold))

    return elapsed, threshold


def should_initiate(record_id: int, personality: dict, emotion_score: int) -> bool:
    """检查是否应该触发一次主动行为。包含8秒冷却，仅用于 trigger 端点。"""
    if not _check_time_reached(record_id, personality, emotion_score):
        return False

    now = datetime.now(UTC).timestamp()
    last_trigger = _last_trigger_time.get(record_id, 0)
    if now - last_trigger < 8:
        return False

    _last_trigger_time[record_id] = now
    return True


def _check_time_reached(record_id: int, personality: dict, emotion_score: int) -> bool:
    """Read-only check: has enough time elapsed to trigger? No side effects."""
    elapsed, threshold = get_initiative_seconds(record_id, personality, emotion_score)
    return elapsed >= threshold


def check_initiate_ready(record_id: int, personality: dict, emotion_score: int) -> bool:
    """Read-only predicate for state polling. Does NOT advance cooldown timer."""
    if not _check_time_reached(record_id, personality, emotion_score):
        return False
    now = datetime.now(UTC).timestamp()
    last_trigger = _last_trigger_time.get(record_id, 0)
    return now - last_trigger >= 8


def cleanup_initiative(record_id: int):
    _initiative_timers.pop(record_id, None)
    _last_trigger_time.pop(record_id, None)


def update_initiative_timer_v2(
    record_id: int,
    cache: "InitiativeCache",
    last_reply_length: int = 0,
) -> None:
    """Reset the initiative timer using a cache instance."""
    from datetime import UTC, datetime
    now = datetime.now(UTC).timestamp()
    cache.update_timer(record_id, now)


def get_initiative_seconds_v2(
    record_id: int,
    cache: "InitiativeCache",
    personality: dict,
    emotion_score: int,
) -> tuple[float, float]:
    """Return (elapsed, threshold) using a cache instance."""
    from datetime import UTC, datetime
    now = datetime.now(UTC).timestamp()
    last_reply = cache.get_timer(record_id, now)
    elapsed = now - last_reply

    patience = personality.get("patience", "normal")
    anxiety_trait = personality.get("anxiety_trait", "normal")
    patience_bias = {"low": -8, "normal": 0, "high": +10}
    anxiety_bias = {"anxious": -5, "normal": 0, "calm": +5}
    emotion_bias = emotion_score * -3
    threshold = 30.0 + patience_bias.get(patience, 0) + anxiety_bias.get(anxiety_trait, 0) + emotion_bias
    threshold = max(15, min(90, threshold))
    return elapsed, threshold


def should_initiate_v2(
    record_id: int,
    cache: "InitiativeCache",
    personality: dict,
    emotion_score: int,
) -> bool:
    """Check using a cache instance."""
    from datetime import UTC, datetime
    elapsed, threshold = get_initiative_seconds_v2(record_id, cache, personality, emotion_score)
    if elapsed < threshold:
        return False
    now = datetime.now(UTC).timestamp()
    last_trigger = cache.get_last_trigger(record_id)
    if now - last_trigger < 8:
        return False
    cache.set_last_trigger(record_id, now)
    return True


def cleanup_initiative_v2(record_id: int, cache: "InitiativeCache") -> None:
    cache.cleanup(record_id)
