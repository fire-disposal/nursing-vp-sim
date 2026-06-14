from unittest.mock import MagicMock

from core.feature_flags import FEATURE_FLAGS, all_feature_flags, is_enabled, resolve_features


def _all_flags() -> dict[str, bool]:
    return {k: v.default for k, v in all_feature_flags().items()}


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


class TestFeatureFlagsRegistry:
    def test_all_flags_have_keys(self):
        for key, flag in FEATURE_FLAGS.items():
            assert flag.key == key

    def test_all_flags_have_labels(self):
        for flag in FEATURE_FLAGS.values():
            assert flag.label
            assert flag.description
