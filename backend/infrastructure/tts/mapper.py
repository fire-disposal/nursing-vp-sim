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
    "withdrawn": (-15, -10),  # slow, soft
    "defensive": (15, 10),  # fast, strong
    "anxious": (10, 0),  # slightly fast
    "neutral": (0, 0),  # baseline
    "relaxed": (-5, 0),  # slightly slow
    "open": (0, 5),  # slightly bright
}

# Real v3 speaker IDs keyed by logical demographic slot.
# NOTE: only the ``vv`` voice is confirmed; the remaining 6 slots fall back to
# the default placeholder until the owner supplies the real console IDs.
SPEAKER_LIBRARY: dict[str, str] = {
    "vv": DEFAULT_SPEAKER,
    "male_young": DEFAULT_SPEAKER,  # 男声·青涩 (待确认)
    "female_young": DEFAULT_SPEAKER,  # 女声·甜美 (待确认)
    "male_teacher": DEFAULT_SPEAKER,  # 男老师 (待确认)
    "child": DEFAULT_SPEAKER,  # 女童 (待确认)
    "male_elder": DEFAULT_SPEAKER,  # 男老人 (待确认)
    "female_elder": DEFAULT_SPEAKER,  # 女老人 (待确认)
}

VALID_SPEAKERS = frozenset(SPEAKER_LIBRARY.values())


def resolve_voice_type(explicit: str | None, age: int | None, gender: str | None) -> str:
    """Resolve the v3 speaker ID with demographic matching.

    Priority:
    1. Explicit v3 speaker ID (validated against the configured library)
    2. Demographic inference: ≤12→child, ≥60→elder, ≤25→young, rest→middle-aged
    3. Default: the ``vv`` placeholder speaker
    """
    if explicit and explicit in VALID_SPEAKERS:
        return explicit
    if explicit:
        log.warning("Invalid speaker '%s', falling back to demographic inference", explicit)

    if age is not None:
        if age <= 12:
            return SPEAKER_LIBRARY["child"]
        if age >= 60:
            return SPEAKER_LIBRARY["female_elder"] if gender == "女" else SPEAKER_LIBRARY["male_elder"]

    if gender == "男":
        return SPEAKER_LIBRARY["male_young"] if (age is not None and age <= 25) else SPEAKER_LIBRARY["male_teacher"]
    if gender == "女":
        return SPEAKER_LIBRARY["female_young"] if (age is not None and age <= 25) else SPEAKER_LIBRARY["vv"]

    return DEFAULT_SPEAKER


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
