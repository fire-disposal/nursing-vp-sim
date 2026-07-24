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

# ── Gender normalization ──────────────────────────────────────────────────────

_GENDER_MALE = frozenset({"男", "男性", "male", "m", "boy", "man"})
_GENDER_FEMALE = frozenset({"女", "女性", "female", "f", "girl", "woman"})


def normalize_gender(value: str | None) -> str | None:
    """Normalize gender strings to ``"男"`` / ``"女"`` for the voice mapper."""
    if not value:
        return None
    v = value.strip().lower()
    if v in _GENDER_MALE:
        return "男"
    if v in _GENDER_FEMALE:
        return "女"
    return None


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
            return lib["child_male"] if gender == "男" else lib["child_female"]
        if age >= 60:
            return lib["female_elder"] if gender == "女" else lib["male_elder"]

    if gender == "男":
        return lib["male_young"] if (age is not None and age <= 25) else lib["male_middle"]
    if gender == "女":
        return lib["female_young"] if (age is not None and age <= 25) else lib["female_middle"]

    return lib["fallback"]


def emotion_to_tts(
    text: str,
    state: str,
    speaker: str = DEFAULT_SPEAKER,
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
        fmt=fmt,
        sample_rate=sample_rate,
    )
