"""Tests for PersonalityProfile — personality-to-emotion parameter mapping."""

import pytest
from profiles.history_taking.emotion_profile import PersonalityProfile


class TestPersonalityProfileDefaults:
    def test_default_personality(self):
        profile = PersonalityProfile.from_personality({})
        assert profile.trust_base == 50
        assert profile.comfort_base == 50
        assert profile.neg_amplify == 1.0
        assert profile.pos_amplify == 1.0
        assert profile.decay == pytest.approx(0.05)

    def test_unknown_trait_defaults_to_normal(self):
        profile = PersonalityProfile.from_personality({"anxiety_trait": "unknown_value"})
        assert profile.trust_base == 50
        assert profile.comfort_base == 50


class TestPersonalityProfileDeviations:
    def test_anxious(self):
        profile = PersonalityProfile.from_personality({"anxiety_trait": "anxious"})
        assert profile.trust_base == 42
        assert profile.comfort_base == 38
        assert profile.neg_amplify == 1.4
        assert profile.pos_amplify == 0.7

    def test_calm(self):
        profile = PersonalityProfile.from_personality({"anxiety_trait": "calm"})
        assert profile.trust_base == 55
        assert profile.comfort_base == 58
        assert profile.neg_amplify == 0.7
        assert profile.pos_amplify == 1.2

    def test_low_patience(self):
        profile = PersonalityProfile.from_personality({"patience": "low"})
        assert profile.comfort_base == 47
        assert profile.decay == pytest.approx(0.08)

    def test_high_patience(self):
        profile = PersonalityProfile.from_personality({"patience": "high"})
        assert profile.comfort_base == 53
        assert profile.decay == pytest.approx(0.02)

    def test_low_literacy(self):
        profile = PersonalityProfile.from_personality({"health_literacy": "low"})
        assert profile.trust_base == 48

    def test_high_literacy(self):
        profile = PersonalityProfile.from_personality({"health_literacy": "high"})
        assert profile.trust_base == 52


class TestPersonalityProfileCombined:
    def test_anxious_low_patience_low_literacy(self):
        profile = PersonalityProfile.from_personality({
            "anxiety_trait": "anxious",
            "patience": "low",
            "health_literacy": "low",
        })
        assert profile.trust_base == 40
        assert profile.comfort_base == 35
        assert profile.neg_amplify == 1.4
        assert profile.pos_amplify == 0.7
        assert profile.decay == pytest.approx(0.08)

    def test_calm_high_patience_high_literacy(self):
        profile = PersonalityProfile.from_personality({
            "anxiety_trait": "calm",
            "patience": "high",
            "health_literacy": "high",
        })
        assert profile.trust_base == 57
        assert profile.comfort_base == 61
        assert profile.neg_amplify == 0.7
        assert profile.pos_amplify == 1.2
        assert profile.decay == pytest.approx(0.02)


class TestPersonalityProfileClamping:
    def test_trust_clamped_low(self):
        profile = PersonalityProfile.from_personality({
            "anxiety_trait": "anxious",
            "patience": "low",
            "health_literacy": "low",
        })
        assert profile.trust_base >= 25

    def test_trust_clamped_high(self):
        profile = PersonalityProfile.from_personality({
            "anxiety_trait": "calm",
            "health_literacy": "high",
        })
        assert profile.trust_base <= 75


class TestPersonalityProfileAmplify:
    def test_amplify_negative_with_anxious(self):
        profile = PersonalityProfile.from_personality({"anxiety_trait": "anxious"})
        dt, dc = profile.amplify(-2, -3)
        assert dt == -2
        assert dc == -4

    def test_amplify_positive_with_anxious(self):
        profile = PersonalityProfile.from_personality({"anxiety_trait": "anxious"})
        dt, dc = profile.amplify(2, 3)
        assert dt == 1
        assert dc == 2

    def test_amplify_mixed_sign_defaults_to_negative(self):
        profile = PersonalityProfile.from_personality({"anxiety_trait": "anxious"})
        dt, dc = profile.amplify(-1, 2)
        assert dt == -1
        assert dc == 2

    def test_amplify_default_neutral(self):
        profile = PersonalityProfile.from_personality({})
        assert profile.amplify(3, 2) == (3, 2)
        assert profile.amplify(-3, -2) == (-3, -2)
