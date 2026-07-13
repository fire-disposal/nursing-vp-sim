"""TTS (Text-to-Speech) infrastructure layer — Volcengine SeedTTS 2.0 (v3)."""

from infrastructure.tts.circuit import CircuitOpenError, TTSCircuitBreaker
from infrastructure.tts.client import TTSRequest, VolcTTSClient
from infrastructure.tts.mapper import (
    _BUILTIN_SPEAKER_LIBRARY,
    DEFAULT_SPEAKER,
    EMOTION_TTS_MAP,
    emotion_to_tts,
    get_speaker_library,
    resolve_voice_type,
)

__all__ = [
    "DEFAULT_SPEAKER",
    "EMOTION_TTS_MAP",
    "_BUILTIN_SPEAKER_LIBRARY",
    "CircuitOpenError",
    "TTSCircuitBreaker",
    "TTSRequest",
    "VolcTTSClient",
    "emotion_to_tts",
    "get_speaker_library",
    "resolve_voice_type",
]
