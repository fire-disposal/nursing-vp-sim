"""四维情绪系统 — 行为策略与渲染器测试。

覆盖 behavior.py 和 renderer.py。
"""

from dataclasses import FrozenInstanceError

import pytest

from modules.training.patient_ai.emotion.behavior import (
    PatientBehaviorPolicy,
    derive_behavior,
)
from modules.training.patient_ai.emotion.models import EmotionVector
from modules.training.patient_ai.emotion.renderer import (
    derive_speech_policy,
    render_behavior_note,
    resolve_dominant_state,
)


class TestDeriveBehavior:
    def test_high_trust_high_disclosure(self):
        """高信任 → 高信息披露。"""
        v = EmotionVector(trust=0.9, anxiety=0.3, irritation=0.1, cooperation=0.8)
        policy = derive_behavior(v)
        assert policy.disclosure > 0.7

    def test_low_trust_low_disclosure(self):
        """低信任 → 低信息披露。"""
        v = EmotionVector(trust=0.2, anxiety=0.3, irritation=0.1, cooperation=0.3)
        policy = derive_behavior(v)
        assert policy.disclosure < 0.5

    def test_high_irritation_low_verbosity(self):
        """高烦躁 → 低回答长度。"""
        v = EmotionVector(trust=0.5, anxiety=0.3, irritation=0.9, cooperation=0.3)
        policy = derive_behavior(v)
        assert policy.verbosity < 0.4

    def test_high_anxiety_high_repetition(self):
        """高焦虑 → 高重复倾向。"""
        v = EmotionVector(trust=0.5, anxiety=0.9, irritation=0.1, cooperation=0.5)
        policy = derive_behavior(v)
        assert policy.repetition > 0.4

    def test_cooperation_reflects_state(self):
        """配合程度直接反映 cooperation 维度。"""
        v = EmotionVector(trust=0.5, anxiety=0.3, irritation=0.2, cooperation=0.85)
        policy = derive_behavior(v)
        assert policy.cooperation == 0.85

    def test_frozen_dataclass(self):
        """PatientBehaviorPolicy 是不可变的。"""
        policy = PatientBehaviorPolicy(
            disclosure=0.5,
            verbosity=0.5,
            initiative=0.3,
            cooperation=0.5,
            repetition=0.0,
            tone="平稳",
            response_style="正常",
        )
        with pytest.raises(FrozenInstanceError):
            policy.disclosure = 0.8  # type: ignore[misc]

    def test_open_trusting_tone(self):
        """高信任低烦躁 → 自然开放的语气。"""
        v = EmotionVector(trust=0.85, anxiety=0.2, irritation=0.1, cooperation=0.9)
        policy = derive_behavior(v)
        assert "自然" in policy.tone

    def test_irritated_tone(self):
        """高烦躁 → 不耐烦语气。"""
        v = EmotionVector(trust=0.4, anxiety=0.3, irritation=0.85, cooperation=0.2)
        policy = derive_behavior(v)
        assert "不耐烦" in policy.tone

    def test_refusal_style_when_low_cooperation(self):
        """低配合时应有拒绝风格。"""
        v = EmotionVector(trust=0.3, anxiety=0.4, irritation=0.7, cooperation=0.2)
        policy = derive_behavior(v)
        assert policy.refusal_style is not None

    def test_no_refusal_when_high_cooperation(self):
        """高配合时无需拒绝风格。"""
        v = EmotionVector(trust=0.7, anxiety=0.3, irritation=0.1, cooperation=0.8)
        policy = derive_behavior(v)
        assert policy.refusal_style is None


class TestRenderBehaviorNote:
    def test_note_contains_tone(self):
        """行为策略 note 包含语气描述。"""
        v = EmotionVector(trust=0.85, anxiety=0.2, irritation=0.1, cooperation=0.9)
        policy = derive_behavior(v)
        note = render_behavior_note(policy)
        assert "语气" in note

    def test_note_does_not_contain_numbers(self):
        """行为策略 note 不包含数值。"""
        v = EmotionVector(trust=0.72, anxiety=0.61, irritation=0.18, cooperation=0.81)
        policy = derive_behavior(v)
        note = render_behavior_note(policy)
        assert "0.72" not in note
        assert "0.61" not in note

    def test_note_has_behavior_boundary(self):
        """行为策略 note 包含边界约束。"""
        v = EmotionVector.neutral()
        policy = derive_behavior(v)
        note = render_behavior_note(policy)
        assert "行为边界" in note
        assert "病例事实" in note


class TestResolveDominantState:
    def test_open_trusting(self):
        v = EmotionVector(trust=0.85, anxiety=0.2, irritation=0.1, cooperation=0.9)
        assert resolve_dominant_state(v) == "open_trusting"

    def test_irritated(self):
        v = EmotionVector(trust=0.3, anxiety=0.3, irritation=0.85, cooperation=0.2)
        assert resolve_dominant_state(v) == "irritated"

    def test_anxious_cooperative(self):
        v = EmotionVector(trust=0.6, anxiety=0.8, irritation=0.2, cooperation=0.7)
        assert resolve_dominant_state(v) == "anxious_cooperative"

    def test_withdrawn(self):
        v = EmotionVector(trust=0.15, anxiety=0.5, irritation=0.3, cooperation=0.2)
        assert resolve_dominant_state(v) == "withdrawn"

    def test_neutral(self):
        v = EmotionVector(trust=0.5, anxiety=0.4, irritation=0.3, cooperation=0.5)
        assert resolve_dominant_state(v) == "neutral"


class TestSpeechPolicy:
    def test_high_anxiety_faster_rate(self):
        """高焦虑 → 语速偏快。"""
        v = EmotionVector(trust=0.5, anxiety=0.8, irritation=0.2, cooperation=0.5)
        sp = derive_speech_policy(v)
        assert sp["rate"] > 1.0

    def test_low_trust_lower_volume(self):
        """低信任 → 音量偏低。"""
        v = EmotionVector(trust=0.2, anxiety=0.4, irritation=0.3, cooperation=0.4)
        sp = derive_speech_policy(v)
        assert sp["volume"] < 1.0

    def test_output_ranges(self):
        """所有输出在合理范围内。"""
        v = EmotionVector.neutral()
        sp = derive_speech_policy(v)
        assert 0.5 <= sp["rate"] <= 2.0
        assert 0.5 <= sp["pitch"] <= 2.0
        assert 0.0 <= sp["pause_tendency"] <= 1.0
        assert 0.0 <= sp["volume"] <= 1.0
