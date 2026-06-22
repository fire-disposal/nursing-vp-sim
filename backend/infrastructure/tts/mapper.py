"""Emotion state → TTS parameter mapping.

Maps the 2D trust-comfort emotion labels to Volcengine TTS emotion
and speech_rate parameters for emotionally-expressive synthesis.
"""

from infrastructure.tts.client import TTSRequest

EMOTION_TTS_MAP: dict[str, dict] = {
    "withdrawn": {"emotion": "sad", "speech_rate": 0.85},
    "defensive": {"emotion": "angry", "speech_rate": 1.15},
    "anxious": {"emotion": "fearful", "speech_rate": 1.10},
    "neutral": {},
    "relaxed": {"emotion": "happy", "speech_rate": 0.95},
    "open": {"emotion": "friendly", "speech_rate": 1.0},
}


def emotion_to_tts(text: str, state: str, voice: str = "zh_female_vv") -> TTSRequest:
    """Build a TTSRequest with emotion parameters based on the patient's emotional state."""
    params = EMOTION_TTS_MAP.get(state, {})
    return TTSRequest(
        text=text,
        voice_type=voice,
        emotion=params.get("emotion"),
        speech_rate=params.get("speech_rate", 1.0),
    )
