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
