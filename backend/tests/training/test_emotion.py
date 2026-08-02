"""Unit tests for emotion engine (v2 compat + v3 consumers)."""

from types import SimpleNamespace
from unittest.mock import patch

from modules.training.patient_ai.emotion import EmoState, EmotionVector
from modules.training.patient_ai.emotion import EmotionState as LegacyEmotionState
from modules.training.pipeline.middleware.side_effects import _read_emotion_state


class TestEmotionState:
    def test_initial_state(self):
        e = LegacyEmotionState()
        assert e.trust == 50
        assert e.comfort == 50
        assert e.state == "neutral"

    def test_positive_delta(self):
        e = LegacyEmotionState()
        e.update(5, 15, "response:配合")
        assert e.trust > 50
        assert e.comfort > 60
        assert e.state == "relaxed"

    def test_negative_delta(self):
        e = LegacyEmotionState()
        e.update(-3, -5, "response:抗拒")
        assert e.trust < 50  # delta pushes below 50
        assert e.comfort < 50
        assert e.state == "neutral"

    def test_s_curve_resists_extreme_lows(self):
        e = LegacyEmotionState(trust=5, comfort=5)
        e.update(3, 3, "")
        assert e.trust < 7
        assert e.comfort > 0

    def test_s_curve_resists_ceiling(self):
        e = LegacyEmotionState(trust=95, comfort=95)
        e.update(3, 3, "")
        assert e.trust < 98
        assert e.comfort < 100

    def test_history_recorded_on_delta(self):
        e = LegacyEmotionState()
        e.update(3, 5, "response:抗拒")
        assert len(e.history) > 0
        assert e.history[0]["intent"] == "response:抗拒"

    def test_no_history_on_zero_delta(self):
        e = LegacyEmotionState()
        e.update(0, 0, "")
        assert len(e.history) == 0

    def test_state_mapping(self):
        assert LegacyEmotionState(trust=10, comfort=10).state == "withdrawn"
        assert LegacyEmotionState(trust=10, comfort=40).state == "defensive"
        assert LegacyEmotionState(trust=40, comfort=10).state == "anxious"
        assert LegacyEmotionState(trust=40, comfort=40).state == "neutral"
        assert LegacyEmotionState(trust=40, comfort=70).state == "relaxed"
        assert LegacyEmotionState(trust=80, comfort=80).state == "open"


class _FakeEmotionCache:
    def __init__(self, state=None, error: Exception | None = None):
        self.state = state
        self.error = error
        self.set_calls = 0

    def get(self, record_id, db):
        if self.error:
            raise self.error
        return self.state

    def set(self, record_id, state, db):
        self.set_calls += 1


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
            result = _resolve_emotion(SimpleNamespace(), 123, object())
        assert result == "open_trusting"

    def test_tts_falls_back_to_neutral_without_creating_state(self):
        from modules.voice.router import _resolve_emotion

        with patch(
            "modules.training.patient_ai.emotion.EmotionRepository.get",
            return_value=None,
        ):
            result = _resolve_emotion(SimpleNamespace(), 123, object())
        assert result == "neutral"

    def test_side_effect_emotion_read_uses_default_without_writing(self):
        cache = _FakeEmotionCache()
        state = _read_emotion_state(
            123,
            cache,
            object(),
            {"anxiety_trait": "calm", "patience": "high", "health_literacy": "high", "compliance": "dependent"},
        )

        assert state.trust == 65
        assert state.comfort == 61
        assert cache.set_calls == 0
