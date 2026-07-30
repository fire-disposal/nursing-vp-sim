"""四维情绪系统 — 规则引擎单元测试。

覆盖规则表、事件应用、恢复、边界阻尼、人格敏感度。
"""

import pytest

from modules.training.patient_ai.emotion.engine import EmotionEngine
from modules.training.patient_ai.emotion.events import DetectedEmotionEvent, EmotionEventType
from modules.training.patient_ai.emotion.models import EmotionState, EmotionVector
from modules.training.patient_ai.emotion.profile import EmotionProfile
from modules.training.patient_ai.emotion.rules import EVENT_RULES


class TestEventRules:
    def test_all_event_types_have_rules(self):
        """每个事件类型都有对应规则。"""
        for event_type in EmotionEventType:
            assert event_type in EVENT_RULES, f"Missing rule for {event_type}"

    def test_empathy_increases_trust(self):
        """共情提高信任并降低焦虑。"""
        delta = EVENT_RULES[EmotionEventType.EMPATHY]
        assert delta.trust > 0
        assert delta.anxiety < 0

    def test_repeated_question_increases_irritation(self):
        """重复询问提高烦躁并降低配合。"""
        delta = EVENT_RULES[EmotionEventType.REPEATED_QUESTION]
        assert delta.irritation > 0
        assert delta.cooperation < 0

    def test_dismissal_is_severe(self):
        """忽视是严重的负面事件。"""
        delta = EVENT_RULES[EmotionEventType.DISMISSAL]
        assert delta.trust < -0.05
        assert delta.irritation > 0.05
        assert delta.cooperation < -0.05


class TestEmotionEngine:
    @pytest.fixture
    def engine(self):
        return EmotionEngine()

    @pytest.fixture
    def neutral_profile(self):
        return EmotionProfile.neutral()

    @pytest.fixture
    def neutral_state(self):
        return EmotionState.initial()

    # ── Recovery ──

    def test_recover_toward_baseline(self, engine, neutral_profile):
        """自然恢复向 baseline 方向移动。"""
        v = EmotionVector(trust=0.3, anxiety=0.7, irritation=0.8, cooperation=0.2)
        v2 = engine.recover(v, neutral_profile)
        # baseline is neutral (0.5, 0.5, 0.35, 0.5)
        assert v2.trust > 0.3  # moving up toward 0.5
        assert v2.anxiety < 0.7  # moving down toward 0.5
        assert v2.irritation < 0.8  # moving down toward 0.35
        assert v2.cooperation > 0.2  # moving up toward 0.5

    def test_recover_already_at_baseline(self, engine, neutral_profile):
        """已是 baseline 则恢复无变化。"""
        v = neutral_profile.baseline
        v2 = engine.recover(v, neutral_profile)
        assert v2.trust == pytest.approx(v.trust)
        assert v2.anxiety == pytest.approx(v.anxiety)

    # ── Apply Events ──

    def test_apply_empathy_event(self, engine, neutral_profile, neutral_state):
        """共情事件提高信任降低焦虑。"""
        events = [DetectedEmotionEvent(type=EmotionEventType.EMPATHY, confidence=0.9)]
        new_state, applied = engine.apply_events(neutral_state, neutral_profile, events)
        assert len(applied) == 1
        assert applied[0].type == EmotionEventType.EMPATHY
        assert new_state.vector.trust > neutral_state.vector.trust
        assert new_state.vector.anxiety < neutral_state.vector.anxiety

    def test_apply_negative_event(self, engine, neutral_profile, neutral_state):
        """评判性语言降低信任提高烦躁。"""
        events = [DetectedEmotionEvent(type=EmotionEventType.JUDGMENTAL_LANGUAGE, confidence=1.0)]
        new_state, applied = engine.apply_events(neutral_state, neutral_profile, events)
        assert len(applied) == 1
        assert new_state.vector.trust < neutral_state.vector.trust
        assert new_state.vector.irritation > neutral_state.vector.irritation

    def test_high_confidence_stronger_than_low(self, engine, neutral_profile):
        """高置信事件影响大于低置信。"""
        state = EmotionState.initial()
        events_high = [DetectedEmotionEvent(type=EmotionEventType.EMPATHY, confidence=1.0)]
        events_low = [DetectedEmotionEvent(type=EmotionEventType.EMPATHY, confidence=0.3)]

        _, applied_high = engine.apply_events(state, neutral_profile, events_high)
        _, applied_low = engine.apply_events(state, neutral_profile, events_low)

        assert applied_high[0].delta.trust > applied_low[0].delta.trust

    def test_boundary_damping(self, engine, neutral_profile):
        """边界阻尼：接近上限时变化减小。"""
        v_high = EmotionVector(trust=0.95, anxiety=0.5, irritation=0.5, cooperation=0.5)
        v_mid = EmotionVector(trust=0.5, anxiety=0.5, irritation=0.5, cooperation=0.5)

        state_high = EmotionState(vector=v_high, version=1)
        state_mid = EmotionState(vector=v_mid, version=1)

        events = [DetectedEmotionEvent(type=EmotionEventType.EMPATHY, confidence=1.0)]
        _, applied_high = engine.apply_events(state_high, neutral_profile, events)
        _, applied_mid = engine.apply_events(state_mid, neutral_profile, events)

        # 高信任时 trust delta 受阻尼影响更小
        assert applied_high[0].delta.trust < applied_mid[0].delta.trust

    def test_empty_events_no_change(self, engine, neutral_profile, neutral_state):
        """无事件时状态不变。"""
        new_state, applied = engine.apply_events(neutral_state, neutral_profile, [])
        assert len(applied) == 0
        assert new_state.version == neutral_state.version

    def test_version_increments_on_change(self, engine, neutral_profile, neutral_state):
        """应用事件后版本递增。"""
        events = [DetectedEmotionEvent(type=EmotionEventType.REASSURANCE, confidence=0.8)]
        new_state, _ = engine.apply_events(neutral_state, neutral_profile, events)
        assert new_state.version == neutral_state.version + 1

    def test_multiple_events_accumulate(self, engine, neutral_profile, neutral_state):
        """多个事件累积应用。"""
        events = [
            DetectedEmotionEvent(type=EmotionEventType.EMPATHY, confidence=1.0),
            DetectedEmotionEvent(type=EmotionEventType.CLEAR_EXPLANATION, confidence=1.0),
        ]
        new_state, applied = engine.apply_events(neutral_state, neutral_profile, events)
        assert len(applied) == 2
        # 两个正面事件 > 一个正面事件
        single_events = [DetectedEmotionEvent(type=EmotionEventType.EMPATHY, confidence=1.0)]
        _, single_applied = engine.apply_events(neutral_state, neutral_profile, single_events)
        assert new_state.vector.trust > single_applied[0].after.trust

    # ── Profile Sensitivity ──

    def test_personality_sensitivity(self, engine):
        """不同人格对同一事件反应不同。"""
        anxious = EmotionProfile.from_personality({"anxiety_trait": "anxious"})
        calm = EmotionProfile.from_personality({"anxiety_trait": "calm"})
        state = EmotionState.initial()

        events = [DetectedEmotionEvent(type=EmotionEventType.BAD_NEWS, confidence=1.0)]
        _, anxious_applied = engine.apply_events(state, anxious, events)
        _, calm_applied = engine.apply_events(state, calm, events)

        # anxious 人格对 bad news 的焦虑增幅更大
        assert anxious_applied[0].delta.anxiety > calm_applied[0].delta.anxiety

    def test_irritable_personality_irritation(self, engine):
        """易怒人格对负面事件烦躁增幅更大。"""
        irritable = EmotionProfile.from_personality({"mood": "irritable"})
        state = EmotionState.initial()

        events = [DetectedEmotionEvent(type=EmotionEventType.REPEATED_QUESTION, confidence=1.0)]
        _, applied = engine.apply_events(state, irritable, events)
        # irritation 值应明显
        assert applied[0].delta.irritation > 0

    # ── Dimension Independence ──

    def test_high_anxiety_does_not_lower_trust(self, engine, neutral_profile):
        """高焦虑不会自动降低信任。维度独立。"""
        v = EmotionVector(trust=0.7, anxiety=0.8, irritation=0.2, cooperation=0.6)
        state = EmotionState(vector=v, version=1)

        # 应用一个仅增加焦虑的事件 (BAD_NEWS)
        events = [DetectedEmotionEvent(type=EmotionEventType.BAD_NEWS, confidence=1.0)]
        new_state, _ = engine.apply_events(state, neutral_profile, events)

        # trust 不应因焦虑上升而下降
        assert new_state.vector.trust == pytest.approx(v.trust, abs=0.001)

    def test_high_trust_does_not_guarantee_high_cooperation(self, engine, neutral_profile):
        """高信任不自动保证高配合。维度独立。"""
        v = EmotionVector(trust=0.8, cooperation=0.3, anxiety=0.3, irritation=0.3)
        assert v.trust > 0.7
        assert v.cooperation < 0.5  # independently low
