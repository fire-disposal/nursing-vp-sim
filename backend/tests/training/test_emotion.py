"""Unit tests for emotion engine (2D trust-comfort model)."""

from contexts.patient.emotion import EmotionState


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

    def test_clamped_at_zero(self):
        e = EmotionState(trust=5, comfort=5)
        e.update(-10, -10, "negative")
        assert e.trust == 0
        assert e.comfort == 0

    def test_clamped_at_hundred(self):
        e = EmotionState(trust=95, comfort=95)
        e.update(10, 10, "positive")
        assert e.trust == 100
        assert e.comfort == 100

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

    def test_decay(self):
        e = EmotionState(trust=80, comfort=80)
        e.decay()
        assert e.trust < 80
        assert e.comfort < 80
        assert e.trust >= 75
        assert e.comfort >= 75

    def test_note_includes_dimensions(self):
        e = EmotionState(trust=25, comfort=18)
        note = e.note
        assert "信赖" in note
        assert "舒适" in note
