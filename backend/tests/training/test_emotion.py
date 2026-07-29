"""Unit tests for emotion engine (2D trust-comfort model)."""

from types import SimpleNamespace

from modules.training.patient_ai.emotion import EmotionState
from modules.training.pipeline.middleware.side_effects import _read_emotion_state
from modules.voice.router import _resolve_emotion


class TestEmotionState:
    def test_initial_state(self):
        e = EmotionState()
        assert e.trust == 50
        assert e.comfort == 50
        assert e.state == "neutral"

    def test_positive_delta(self):
        e = EmotionState()
        e.update(6, 10, "response:积极")
        assert e.trust == 56
        assert e.comfort == 60
        assert e.state == "relaxed"

    def test_negative_delta(self):
        e = EmotionState()
        e.update(-8, -12, "response:消极")
        assert e.trust == 42
        assert e.comfort == 38
        assert e.state == "neutral"

    def test_s_curve_resists_extreme_lows(self):
        e = EmotionState(trust=5, comfort=5)
        e.update(-10, -10, "negative")
        assert e.trust > 0
        assert e.comfort > 0

    def test_s_curve_resists_ceiling(self):
        e = EmotionState(trust=95, comfort=95)
        e.update(10, 10, "positive")
        assert e.trust < 100
        assert e.comfort < 100

    def test_history_recorded_on_delta(self):
        e = EmotionState()
        e.update(-8, -12, "response:抗拒")
        assert len(e.history) == 1
        assert e.history[0]["intent"] == "response:抗拒"

    def test_no_history_on_zero_delta(self):
        e = EmotionState()
        e.update(0, 0, "")
        assert len(e.history) == 0

    def test_state_mapping(self):
        assert EmotionState(trust=10, comfort=10).state == "withdrawn"
        assert EmotionState(trust=35, comfort=20).state == "anxious"
        assert EmotionState(trust=50, comfort=50).state == "neutral"
        assert EmotionState(trust=40, comfort=70).state == "relaxed"
        assert EmotionState(trust=80, comfort=80).state == "open"

    def test_note_includes_dimensions(self):
        e = EmotionState(trust=25, comfort=18)
        note = e.note
        assert "信赖" in note
        assert "舒适" in note


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
        cache = _FakeEmotionCache(EmotionState(trust=90, comfort=90))
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(emotion_cache=cache)))

        assert _resolve_emotion(request, 123, object()) == "open"
        assert cache.set_calls == 0

    def test_tts_falls_back_to_neutral_without_creating_state(self):
        cache = _FakeEmotionCache()
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(emotion_cache=cache)))

        assert _resolve_emotion(request, 123, object()) == "neutral"
        assert cache.set_calls == 0

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
