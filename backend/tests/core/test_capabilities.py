from unittest.mock import MagicMock

from core.capabilities import (
    ALL_CAPABILITIES,
    ALL_CAPABILITY_KEYS,
    all_capabilities,
    effective_features,
    is_enabled,
    resolve_features,
)


def _all_flags() -> dict[str, bool]:
    return {k: v.default for k, v in all_capabilities().items()}


def _expected(**overrides: bool) -> dict[str, bool]:
    return {**_all_flags(), **overrides}


class TestResolveFeatures:
    def test_defaults_when_no_snapshot(self):
        result = resolve_features(None)
        assert result == _all_flags()

    def test_defaults_when_empty_snapshot(self):
        result = resolve_features({})
        assert result == _all_flags()

    def test_override_single_flag(self):
        result = resolve_features({"features": {"physical_exam": True}})
        assert result == _expected(physical_exam=True)

    def test_override_all_flags(self):
        result = resolve_features({"features": {"physical_exam": True, "patient_initiative": True}})
        assert result == _expected(physical_exam=True, patient_initiative=True)

    def test_unknown_key_ignored(self):
        result = resolve_features({"features": {"unknown_flag": True}})
        assert result == _all_flags()


class TestIsEnabled:
    def test_false_by_default(self):
        record = MagicMock()
        record.practice_snapshot = None
        assert is_enabled(record, "physical_exam") is False

    def test_true_when_overridden(self):
        record = MagicMock()
        record.practice_snapshot = {"features": {"physical_exam": True}}
        assert is_enabled(record, "physical_exam") is True

    def test_unknown_key_returns_false(self):
        record = MagicMock()
        record.practice_snapshot = None
        assert is_enabled(record, "nonexistent") is False


class TestCapabilitiesRegistry:
    def test_all_flags_have_keys(self):
        for key, flag in ALL_CAPABILITIES.items():
            assert flag.key == key

    def test_all_flags_have_labels(self):
        for flag in ALL_CAPABILITIES.values():
            assert flag.label
            assert flag.description

    def test_questionnaire_flag_exists(self):
        assert "questionnaire" in ALL_CAPABILITIES


class TestEffectiveFeatures:
    def test_default_all_false(self):
        result = effective_features()
        assert result == dict.fromkeys(ALL_CAPABILITY_KEYS, False)

    def test_student_choices_override(self):
        result = effective_features({"physical_exam": True})
        expected = dict.fromkeys(ALL_CAPABILITY_KEYS, False)
        expected["physical_exam"] = True
        assert result == expected

    def test_case_plugins_force_enable(self):
        result = effective_features({}, ["physical_exam"])
        expected = dict.fromkeys(ALL_CAPABILITY_KEYS, False)
        expected["physical_exam"] = True
        assert result == expected

    def test_initiative_depends_emotion(self):
        result = effective_features({"patient_initiative": True})
        assert result["patient_initiative"] is True
        assert result["emotion"] is True

    def test_student_choice_wins_over_plugin(self):
        result = effective_features({"physical_exam": False}, ["physical_exam"])
        assert not result["physical_exam"]
