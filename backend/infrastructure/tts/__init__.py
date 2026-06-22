"""TTS (Text-to-Speech) infrastructure layer — Volcengine Large Model TTS."""

from infrastructure.tts.circuit import CircuitOpenError, TTSCircuitBreaker
from infrastructure.tts.client import TTSRequest, VolcTTSClient
from infrastructure.tts.mapper import EMOTION_TTS_MAP, VALID_VOICE_TYPES, emotion_to_tts, resolve_voice_type

__all__ = [
    "EMOTION_TTS_MAP",
    "VALID_VOICE_TYPES",
    "CircuitOpenError",
    "TTSCircuitBreaker",
    "TTSRequest",
    "VolcTTSClient",
    "emotion_to_tts",
    "resolve_voice_type",
]
