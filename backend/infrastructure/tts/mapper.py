"""Emotion state → TTS parameter mapping (Volcengine v3 / SeedTTS 2.0).

v3 dropped the ``emotion`` field, so the 2D trust-comfort emotion labels are
expressed through integer ``speech_rate`` + ``loudness_rate`` adjustments on
the low-latency ``standard`` model. Both rates are in the range [-50, 100].
"""

import logging

from infrastructure.tts.client import TTSRequest

log = logging.getLogger(__name__)

DEFAULT_SPEAKER = "zh_female_vv_uranus_bigtts"

# emotion state → (speech_rate, loudness_rate)
EMOTION_TTS_MAP: dict[str, tuple[int, int]] = {
    "withdrawn": (-15, -10),
    "defensive": (15, 10),
    "anxious": (10, 0),
    "neutral": (0, 0),
    "relaxed": (-5, 0),
    "open": (0, 5),
}

# Built-in defaults — overridden by VoiceConfig.speaker_library in DB.
_BUILTIN_SPEAKER_LIBRARY: dict[str, str] = {
    "vv": DEFAULT_SPEAKER,
    "male_young": DEFAULT_SPEAKER,
    "female_young": DEFAULT_SPEAKER,
    "male_teacher": DEFAULT_SPEAKER,
    "child": DEFAULT_SPEAKER,
    "male_elder": DEFAULT_SPEAKER,
    "female_elder": DEFAULT_SPEAKER,
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
) -> str:
    lib = get_speaker_library(speaker_library)
    valid = frozenset(lib.values())

    if explicit and explicit in valid:
        return explicit
    if explicit:
        log.warning("Invalid speaker '%s', falling back to demographic inference", explicit)

    if age is not None:
        if age <= 12:
            return lib["child"]
        if age >= 60:
            return lib["female_elder"] if gender == "女" else lib["male_elder"]

    if gender == "男":
        return lib["male_young"] if (age is not None and age <= 25) else lib["male_teacher"]
    if gender == "女":
        return lib["female_young"] if (age is not None and age <= 25) else lib["vv"]

    return lib["vv"]


def emotion_to_tts(
    text: str,
    state: str,
    speaker: str = DEFAULT_SPEAKER,
    model: str = "seed-tts-2.0-standard",
    fmt: str = "mp3",
    sample_rate: int = 24000,
) -> TTSRequest:
    """Build a TTSRequest with emotion-driven speech/loudness rates."""
    speech_rate, loudness_rate = EMOTION_TTS_MAP.get(state, (0, 0))
    return TTSRequest(
        text=text,
        speaker=speaker,
        speech_rate=speech_rate,
        loudness_rate=loudness_rate,
        model=model,
        fmt=fmt,
        sample_rate=sample_rate,
    )
