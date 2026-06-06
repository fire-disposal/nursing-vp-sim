from unittest.mock import MagicMock

from services.feature_flags import FEATURE_FLAGS, is_enabled, resolve_features


class TestResolveFeatures:
    def test_defaults_when_no_snapshot(self):
        result = resolve_features(None)
        assert result == {"physical_exam": False, "patient_initiative": False}

    def test_defaults_when_empty_snapshot(self):
        result = resolve_features({})
        assert result == {"physical_exam": False, "patient_initiative": False}

    def test_override_single_flag(self):
        result = resolve_features({"features": {"physical_exam": True}})
        assert result == {"physical_exam": True, "patient_initiative": False}

    def test_override_all_flags(self):
        result = resolve_features({"features": {"physical_exam": True, "patient_initiative": True}})
        assert result == {"physical_exam": True, "patient_initiative": True}

    def test_unknown_key_ignored(self):
        result = resolve_features({"features": {"unknown_flag": True}})
        assert result == {"physical_exam": False, "patient_initiative": False}


class TestIsEnabled:
    def test_false_by_default(self):
        record = MagicMock()
        record.config_snapshot = None
        assert is_enabled(record, "physical_exam") is False

    def test_true_when_overridden(self):
        record = MagicMock()
        record.config_snapshot = {"features": {"physical_exam": True}}
        assert is_enabled(record, "physical_exam") is True

    def test_unknown_key_returns_false(self):
        record = MagicMock()
        record.config_snapshot = None
        assert is_enabled(record, "nonexistent") is False


class TestFeatureFlagsRegistry:
    def test_all_flags_have_keys(self):
        for key, flag in FEATURE_FLAGS.items():
            assert flag.key == key

    def test_all_flags_have_labels(self):
        for flag in FEATURE_FLAGS.values():
            assert flag.label
            assert flag.description
