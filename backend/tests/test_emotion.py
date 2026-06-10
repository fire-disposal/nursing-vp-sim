"""Unit tests for emotion engine (2D trust-comfort model)."""
from contexts.patient.emotion import EmotionState, classify_intent


class TestClassifyIntent:
    def test_care_empathy(self):
        assert classify_intent("别担心，慢慢说") == "关心/共情"
        assert classify_intent("没关系，会好的") == "关心/共情"

    def test_explain_reason(self):
        assert classify_intent("因为需要评估一下你的情况") == "解释原因"

    def test_apology_soothe(self):
        assert classify_intent("抱歉打扰了") == "道歉/安抚"

    def test_rude_accuse(self):
        assert classify_intent("你必须快点") == "粗鲁/指责"

    def test_privacy_probe(self):
        assert classify_intent("你抽烟吗") == "追问隐私"

    def test_urge(self):
        # "快点" matches both "粗鲁/指责" and "催促" — first match wins
        assert classify_intent("快点，还要多久") == "粗鲁/指责"

    def test_vague(self):
        assert classify_intent("嗯，知道了") == "不明确"

    def test_neutral(self):
        assert classify_intent("请问你哪里不舒服") == "普通提问"

    def test_empty(self):
        assert classify_intent("") == "普通提问"


class TestEmotionState:
    def test_initial_state(self):
        e = EmotionState()
        assert e.trust == 50
        assert e.comfort == 50
        assert e.state == "neutral"

    def test_care_improves_comfort(self):
        e = EmotionState()
        e.update("关心/共情")
        assert e.trust == 55
        assert e.comfort == 65
        assert e.state == "relaxed"

    def test_explanation_improves_trust(self):
        e = EmotionState()
        e.update("解释原因")
        assert e.trust == 65
        assert e.comfort == 55

    def test_rude_damages_both(self):
        e = EmotionState()
        e.update("粗鲁/指责")
        assert e.trust == 40
        assert e.comfort == 35

    def test_privacy_hurts_comfort(self):
        e = EmotionState()
        e.update("追问隐私")
        assert e.trust == 45
        assert e.comfort == 38

    def test_clamped_at_zero(self):
        e = EmotionState(trust=5, comfort=5)
        e.update("粗鲁/指责")
        assert e.trust == 0
        assert e.comfort == 0

    def test_clamped_at_hundred(self):
        e = EmotionState(trust=95, comfort=95)
        e.update("关心/共情")
        assert e.trust == 100
        assert e.comfort == 100

    def test_history_recorded_on_change(self):
        e = EmotionState()
        e.update("粗鲁/指责")
        assert len(e.history) == 1
        assert e.history[0]["intent"] == "粗鲁/指责"

    def test_neutral_no_history_on_stable(self):
        e = EmotionState()
        e.update("普通提问")
        assert len(e.history) == 0

    def test_state_mapping(self):
        assert EmotionState(trust=10, comfort=10).state == "withdrawn"
        assert EmotionState(trust=35, comfort=20).state == "defensive"
        assert EmotionState(trust=50, comfort=50).state == "neutral"
        assert EmotionState(trust=40, comfort=70).state == "relaxed"
        assert EmotionState(trust=80, comfort=80).state == "open"

    def test_note_includes_dimensions(self):
        e = EmotionState(trust=25, comfort=18)
        note = e.note
        assert "信赖: 25" in note or "25" in note
        assert "舒适: 18" in note or "18" in note

    def test_update_returns_delta(self):
        e = EmotionState()
        old_t, old_c = e.trust, e.comfort
        e.update("粗鲁/指责")
        assert e.trust == old_t - 10
        assert e.comfort == old_c - 15
