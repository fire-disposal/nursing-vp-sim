"""TTS (Text-to-Speech) infrastructure layer — Volcengine Large Model TTS."""

from infrastructure.tts.client import TTSRequest, VolcTTSClient
from infrastructure.tts.mapper import EMOTION_TTS_MAP, emotion_to_tts

__all__ = ["EMOTION_TTS_MAP", "TTSRequest", "VolcTTSClient", "emotion_to_tts"]
