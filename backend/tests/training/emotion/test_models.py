"""四维情绪系统 — 核心模型单元测试。

覆盖：EmotionVector, EmotionDelta, EmotionState, clamp, 边界行为。
"""

import pytest

from modules.training.patient_ai.emotion.models import (
    EmotionDelta,
    EmotionState,
    EmotionVector,
    clamp01,
)


class TestClamp:
    def test_mid_range(self):
        assert clamp01(0.5) == 0.5

    def test_below_zero(self):
        assert clamp01(-0.5) == 0.0
        assert clamp01(-100.0) == 0.0

    def test_above_one(self):
        assert clamp01(1.5) == 1.0
        assert clamp01(100.0) == 1.0

    def test_boundaries(self):
        assert clamp01(0.0) == 0.0
        assert clamp01(1.0) == 1.0


class TestEmotionDelta:
    def test_zero_delta(self):
        d = EmotionDelta()
        assert d.trust == 0.0
        assert d.anxiety == 0.0
        assert d.irritation == 0.0
        assert d.cooperation == 0.0
        assert d.is_zero()

    def test_scaled(self):
        d = EmotionDelta(trust=0.1, anxiety=-0.05)
        sd = d.scaled(0.5)
        assert sd.trust == 0.05
        assert sd.anxiety == -0.025
        assert sd.irritation == 0.0

    def test_add(self):
        d1 = EmotionDelta(trust=0.1, anxiety=-0.05)
        d2 = EmotionDelta(trust=-0.02, irritation=0.03)
        result = d1 + d2
        assert result.trust == 0.08
        assert result.anxiety == -0.05
        assert result.irritation == 0.03

    def test_to_dict(self):
        d = EmotionDelta(trust=0.05, irritation=0.02)
        data = d.to_dict()
        assert data == {"trust": 0.05, "anxiety": 0.0, "irritation": 0.02, "cooperation": 0.0}

    def test_frozen(self):
        d = EmotionDelta(trust=0.1)
        with pytest.raises(Exception):
            d.trust = 0.2  # type: ignore[misc]


class TestEmotionVector:
    def test_apply_delta(self):
        v = EmotionVector(trust=0.5, anxiety=0.5, irritation=0.3, cooperation=0.5)
        d = EmotionDelta(trust=0.04, anxiety=-0.05)
        v2 = v.apply(d)
        assert v2.trust == 0.54
        assert v2.anxiety == 0.45
        assert v2.irritation == 0.3  # unchanged

    def test_apply_clamps_to_zero(self):
        v = EmotionVector(trust=0.02, anxiety=0.0, irritation=0.0, cooperation=0.0)
        d = EmotionDelta(trust=-0.05)
        v2 = v.apply(d)
        assert v2.trust == 0.0  # clamped

    def test_apply_clamps_to_one(self):
        v = EmotionVector(trust=0.98, anxiety=1.0, irritation=0.0, cooperation=1.0)
        d = EmotionDelta(trust=0.05, anxiety=0.0, cooperation=0.1)
        v2 = v.apply(d)
        assert v2.trust == 1.0
        assert v2.cooperation == 1.0

    def test_independence(self):
        """四维独立：高信任不自动降低焦虑。"""
        v = EmotionVector(trust=0.8, anxiety=0.7, irritation=0.2, cooperation=0.6)
        assert v.trust == 0.8
        assert v.anxiety == 0.7  # still high despite high trust

    def test_to_dict_roundtrip(self):
        v = EmotionVector(trust=0.72, anxiety=0.61, irritation=0.18, cooperation=0.81)
        data = v.to_dict()
        v2 = EmotionVector.from_dict(data)
        assert v2.trust == v.trust
        assert v2.anxiety == v.anxiety
        assert v2.irritation == v.irritation
        assert v2.cooperation == v.cooperation

    def test_neutral(self):
        v = EmotionVector.neutral()
        assert v.trust == 0.50
        assert v.anxiety == 0.50
        assert v.irritation == 0.35
        assert v.cooperation == 0.50


class TestEmotionState:
    def test_initial(self):
        state = EmotionState.initial()
        assert state.version == 1
        assert state.vector.trust == 0.50
        assert state.last_turn_id is None

    def test_initial_with_vector(self):
        v = EmotionVector(trust=0.7, anxiety=0.3, irritation=0.1, cooperation=0.8)
        state = EmotionState.initial(v)
        assert state.vector.trust == 0.7

    def test_apply_increments_version(self):
        state = EmotionState.initial()
        delta = EmotionDelta(trust=0.04)
        new_state = state.apply(delta, "turn-1")
        assert new_state.version == 2
        assert new_state.last_turn_id == "turn-1"
        assert new_state.vector.trust == 0.54

    def test_to_dict_roundtrip(self):
        v = EmotionVector(trust=0.6, anxiety=0.4, irritation=0.2, cooperation=0.7)
        state = EmotionState(vector=v, version=3, last_turn_id="turn-abc")
        data = state.to_dict()
        s2 = EmotionState.from_dict(data)
        assert s2.vector.trust == 0.6
        assert s2.version == 3
        assert s2.last_turn_id == "turn-abc"
