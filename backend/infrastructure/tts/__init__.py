"""TTS (Text-to-Speech) infrastructure layer — Volcengine SeedTTS 2.0 (v3)."""

from infrastructure.tts.circuit import CircuitOpenError, TTSCircuitBreaker
from infrastructure.tts.client import TTSRequest, VolcTTSClient
from infrastructure.tts.mapper import (
    DEFAULT_SPEAKER,
    EMOTION_TTS_MAP,
    SPEAKER_LIBRARY,
    VALID_SPEAKERS,
    emotion_to_tts,
    resolve_voice_type,
)

__all__ = [
    "DEFAULT_SPEAKER",
    "EMOTION_TTS_MAP",
    "SPEAKER_LIBRARY",
    "VALID_SPEAKERS",
    "CircuitOpenError",
    "TTSCircuitBreaker",
    "TTSRequest",
    "VolcTTSClient",
    "emotion_to_tts",
    "resolve_voice_type",
]
