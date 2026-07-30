"""TTS (Text-to-Speech) infrastructure layer — Volcengine SeedTTS 2.0 (v3)."""

from infra.tts.circuit import CircuitOpenError, TTSCircuitBreaker
from infra.tts.client import TTSRequest, VolcBidirectionalTTSClient, VolcTTSConnection
from infra.tts.mapper import (
    DEFAULT_SPEAKER,
    get_speaker_library,
    resolve_voice_type,
)
from infra.tts.pool import TTSConnectionPool

__all__ = [
    "DEFAULT_SPEAKER",
    "CircuitOpenError",
    "TTSCircuitBreaker",
    "TTSConnectionPool",
    "TTSRequest",
    "VolcBidirectionalTTSClient",
    "VolcTTSConnection",
    "get_speaker_library",
    "resolve_voice_type",
]
