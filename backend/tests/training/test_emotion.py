"""Unit tests for emotion v3 consumers (TTS emotion resolution)."""

from types import SimpleNamespace
from typing import TYPE_CHECKING, cast
from unittest.mock import patch

if TYPE_CHECKING:
    from fastapi import Request


_FAKE_REQUEST = cast("Request", SimpleNamespace())

from modules.training.patient_ai.emotion import EmoState, EmotionVector


class TestEmotionConsumers:
    def test_tts_resolves_existing_emotion_without_writing(self):
        from modules.voice.router import _resolve_emotion

        mock_state = EmoState(
            vector=EmotionVector(trust=0.9, anxiety=0.1, irritation=0.1, cooperation=0.9),
            version=1,
        )
        with patch(
            "modules.training.patient_ai.emotion.EmotionRepository.get",
            return_value=mock_state,
        ):
            result = _resolve_emotion(_FAKE_REQUEST, 123, object())
        assert result == "open_trusting"

    def test_tts_falls_back_to_neutral_without_creating_state(self):
        from modules.voice.router import _resolve_emotion

        with patch(
            "modules.training.patient_ai.emotion.EmotionRepository.get",
            return_value=None,
        ):
            result = _resolve_emotion(_FAKE_REQUEST, 123, object())
        assert result == "neutral"
