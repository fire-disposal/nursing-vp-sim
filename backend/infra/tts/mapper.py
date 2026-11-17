"""Speaker + emotion-instruction resolution for Volcengine SeedTTS 2.0 (v3).

TTS 2.0 infers emotion from text context and accepts natural-language
instructions via ``req_params.additions.context_texts``. We therefore never
touch speech_rate/loudness_rate — the neural expressiveness is left intact and
emotion is conveyed purely by one restrained instruction sentence.
"""

import logging

from core.gender import GENDER_FEMALE, GENDER_MALE

log = logging.getLogger(__name__)

DEFAULT_SPEAKER = "zh_female_vv_uranus_bigtts"

# Built-in defaults — overridden by VoiceConfig.speaker_library in DB.
# 9 demographic slots. Every ID must be a "豆包语音合成模型2.0" voice
# (``*_uranus_bigtts``), which is the only family that honours context_texts;
# old ``*_bigtts``/``*_moon_bigtts`` IDs are rejected server-side on the
# ``seed-tts-2.0`` resource and silently drop the emotion instruction.
_BUILTIN_SPEAKER_LIBRARY: dict[str, str] = {
    # 天才童声 2.0 — 男童，明亮
    "child_male": "zh_male_tiancaitongsheng_uranus_bigtts",
    # 萌丫头 2.0 — 女童，俏皮
    "child_female": "zh_female_mengyatou_uranus_bigtts",
    # 小天 2.0 — 青年男，明亮轻快（贴近卧病在床的年轻人）
    "male_young": "zh_male_taocheng_uranus_bigtts",
    # 温暖阿虎 2.0 — 中年男，温和
    "male_middle": "zh_male_wennuanahu_uranus_bigtts",
    # 渊博小叔 2.0 — 老年男，沉稳有阅历
    "male_elder": "zh_male_yuanboxiaoshu_uranus_bigtts",
    # 清新女声 2.0 — 青年女，清亮
    "female_young": "zh_female_qingxinnvsheng_uranus_bigtts",
    # 温柔妈妈 2.0 — 中年女，温暖
    "female_middle": "zh_female_wenroumama_uranus_bigtts",
    # 婆婆 2.0 — 老年女，温暖
    "female_elder": "zh_female_popo_uranus_bigtts",
    "fallback": DEFAULT_SPEAKER,
}

# ── Emotion → natural-language TTS instruction ──
#
# One short sentence per dominant_state, phrased as a patient speaking to a
# nurse: restrained, never theatrical, and never changing *what* is said — only
# how（语气）. Keys must cover every label ``resolve_dominant_state`` can return
# plus ``neutral``.
_EMOTION_INSTRUCTIONS: dict[str, str] = {
    "irritated": "语气不耐烦，但压着脾气，说话简短克制。",
    "anxious_cooperative": "语气焦虑不安，有点着急，但愿意配合，带着求助的口吻。",
    "anxious_guarded": "语气焦虑又戒备，说话迟疑，对被追问有些回避。",
    "trusting_anxious": "语气信任对方，但仍带着担忧和焦虑，边说边有些不安。",
    "withdrawn": "语气疏离、低落，话很少，回应得敷衍又不情愿。",
    "defensive": "语气戒备、冷淡，不肯多说，带着防备和推拒。",
    "open_trusting": "语气温和坦诚，愿意配合，像在放心地跟人交谈。",
    "relaxed": "语气放松温和，平静从容，带着自然的亲切感。",
    "neutral": "语气平静自然，像普通人正常说话。",
}

# Fallback used when the caller passes an unknown/empty label.
DEFAULT_EMOTION_STATE = "neutral"


def emotion_label(emotion_state: str | None) -> str:
    """Map an arbitrary dominant_state label onto a known one.

    Unknown labels fall back to ``neutral`` so a new emotion label (or a
    missing state lookup) still yields a well-defined, calm instruction
    instead of an empty context_texts.
    """
    label = (emotion_state or "").strip()
    return label if label in _EMOTION_INSTRUCTIONS else DEFAULT_EMOTION_STATE


def resolve_context_texts(emotion_state: str | None) -> list[str]:
    """Return the single TTS 2.0 instruction for ``emotion_state``.

    Always returns exactly one non-empty string, so the instruction reaches
    every upstream request unconditionally.
    """
    return [_EMOTION_INSTRUCTIONS[emotion_label(emotion_state)]]


def get_speaker_library(db_config: dict | None = None) -> dict[str, str]:
    """Merge DB overrides on top of built-in defaults."""
    lib = dict(_BUILTIN_SPEAKER_LIBRARY)
    if db_config:
        lib.update(db_config)
    return lib


def resolve_voice_type(
    explicit: str | None,
    age: int | None,
    gender: str | None,
    speaker_library: dict[str, str] | None = None,
    override: str | None = None,
) -> str:
    """Resolve speaker ID by priority: override > explicit > demographic > fallback.

    ``override`` is the highest‑priority case‑level custom voice (case_data.voice_override).
    ``explicit`` is the case's configured voice_type (case_data.voice_type).
    If neither is set, demographic matching via age + gender is attempted.
    """
    lib = get_speaker_library(speaker_library)
    valid = frozenset(lib.values())

    if override:
        if override in valid:
            return override
        log.warning("Invalid voice_override '%s', falling through", override)

    if explicit and explicit in valid:
        return explicit
    if explicit:
        log.warning("Invalid voice_type '%s', falling back to demographic inference", explicit)

    if age is not None:
        if age <= 12:
            return lib["child_male"] if gender == GENDER_MALE else lib["child_female"]
        if age >= 60:
            return lib["female_elder"] if gender == GENDER_FEMALE else lib["male_elder"]

    if gender == GENDER_MALE:
        return lib["male_young"] if (age is not None and age <= 25) else lib["male_middle"]
    if gender == GENDER_FEMALE:
        return lib["female_young"] if (age is not None and age <= 25) else lib["female_middle"]

    return lib["fallback"]
