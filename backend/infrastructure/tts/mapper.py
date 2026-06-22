"""Emotion state → TTS parameter mapping.

Maps the 2D trust-comfort emotion labels to Volcengine TTS emotion
and speech_rate parameters for emotionally-expressive synthesis.
"""

import logging

from infrastructure.tts.client import TTSRequest

log = logging.getLogger(__name__)

EMOTION_TTS_MAP: dict[str, dict] = {
    "withdrawn": {"emotion": "sad", "speech_rate": 0.85},
    "defensive": {"emotion": "angry", "speech_rate": 1.15},
    "anxious": {"emotion": "fearful", "speech_rate": 1.10},
    "neutral": {},
    "relaxed": {"emotion": "happy", "speech_rate": 0.95},
    "open": {"emotion": "friendly", "speech_rate": 1.0},
}

VALID_VOICE_TYPES = frozenset(
    {
        "zh_female_vv",
        "zh_male_qingse",
        "zh_female_tianmei",
        "zh_male_laoshi",
        "zh_female_child",
        "zh_male_elder",
        "zh_female_elder",
    }
)


def resolve_voice_type(explicit: str | None, age: int | None, gender: str | None) -> str:
    """Resolve the Volcengine voice_type with demographic matching.

    Priority:
    1. Explicit voice_type from request or case config (validated)
    2. Demographic inference: ≤12→child, ≥60→elder, ≤25→young, rest→middle-aged
    3. Default: "zh_female_vv"
    """
    if explicit and explicit in VALID_VOICE_TYPES:
        return explicit
    if explicit:
        log.warning("Invalid voice_type '%s', falling back to demographic inference", explicit)

    if age is not None:
        if age <= 12:
            return "zh_female_child"
        if age >= 60:
            return "zh_female_elder" if gender == "女" else "zh_male_elder"

    if gender == "男":
        return "zh_male_qingse" if (age is not None and age <= 25) else "zh_male_laoshi"
    if gender == "女":
        return "zh_female_tianmei" if (age is not None and age <= 25) else "zh_female_vv"

    return "zh_female_vv"


def emotion_to_tts(text: str, state: str, voice: str = "zh_female_vv") -> TTSRequest:
    """Build a TTSRequest with emotion parameters based on the patient's emotional state."""
    params = EMOTION_TTS_MAP.get(state, {})
    return TTSRequest(
        text=text,
        voice_type=voice,
        emotion=params.get("emotion"),
        speech_rate=params.get("speech_rate", 1.0),
    )
