"""Speaker resolution for Volcengine SeedTTS 2.0 (v3).

TTS 2.0 natively infers emotion from text context — no artificial
speech_rate/loudness_rate manipulation is applied. The model's neural
expressiveness is left intact.
"""

import logging

from core.gender import GENDER_FEMALE, GENDER_MALE

log = logging.getLogger(__name__)

DEFAULT_SPEAKER = "zh_female_vv_uranus_bigtts"

# Built-in defaults — overridden by VoiceConfig.speaker_library in DB.
# 9 demographic slots with distinct speakers for child/young/middle/elder × male/female.
_BUILTIN_SPEAKER_LIBRARY: dict[str, str] = {
    "child_male": "zh_male_qingse_bigtts",
    "child_female": "zh_female_qingxin_bigtts",
    "male_young": "zh_male_qingse_bigtts",
    "male_middle": "zh_male_wennuan_bigtts",
    "male_elder": "zh_male_wennuan_bigtts",
    "female_young": "zh_female_qingxin_bigtts",
    "female_middle": "zh_female_wenrou_bigtts",
    "female_elder": "zh_female_wenrou_bigtts",
    "fallback": DEFAULT_SPEAKER,
}


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


# ── Emotion → natural-language context_texts for TTS 2.0 ──
# TTS 2.0 natively interprets these descriptions — no mechanical
# speech_rate/loudness_rate manipulation needed.
# Pattern: verb + body description + scene — describe what the voice
# sounds like, not just a label.

EMOTION_CONTEXT_MAP: dict[str, str] = {
    "open_trusting": "用温暖自然的语气，声音平稳，像在跟信任的朋友说话",
    "trusting_anxious": "用担忧但信任的语气，声音略快，带着关心的急切",
    "irritated": "用不耐烦的语气，声音有点冲，语速偏快，带着烦躁",
    "anxious_cooperative": "用略微紧张但愿意配合的语气，声音稍微急促但态度配合",
    "anxious_guarded": "用紧张戒备的语气，声音压得比较低，回答谨慎犹豫",
    "withdrawn": "用沉默低落的语气，声音很轻很慢，不想多说",
    "defensive": "用防备抗拒的语气，声音硬一些，回答简短不情愿",
    "relaxed": "用放松自然的语气，声音平滑舒适，态度友好",
    "neutral": "用平稳正常的语气交流",
}


def resolve_emotion_context(state: str) -> list[str]:
    """Resolve emotion label to context_texts for TTS 2.0.

    Returns a single-element list suitable for the additions.context_texts
    field. Returns empty list for unknown labels (no emotion control).
    """
    prompt = EMOTION_CONTEXT_MAP.get(state)
    return [prompt] if prompt else []
