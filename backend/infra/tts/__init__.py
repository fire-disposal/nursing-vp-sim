"""TTS (Text-to-Speech) infrastructure layer — Volcengine SeedTTS 2.0 (v3)."""

from infra.tts.circuit import CircuitOpenError, TTSCircuitBreaker
from infra.tts.client import TTSRequest, VolcBidirectionalTTSClient, VolcTTSConnection
from infra.tts.mapper import (
    DEFAULT_SPEAKER,
    EMOTION_TTS_MAP,
    emotion_to_tts,
    get_speaker_library,
    resolve_voice_type,
)
from infra.tts.pool import TTSConnectionPool

__all__ = [
    "DEFAULT_SPEAKER",
    "EMOTION_TTS_MAP",
    "CircuitOpenError",
    "TTSCircuitBreaker",
    "TTSConnectionPool",
    "TTSRequest",
    "VolcBidirectionalTTSClient",
    "VolcTTSConnection",
    "emotion_to_tts",
    "get_speaker_library",
    "resolve_voice_type",
]
