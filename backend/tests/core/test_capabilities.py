from unittest.mock import MagicMock

from contexts.training.capabilities import (
    ALL_CAPABILITIES,
    all_capabilities,
    capabilities_for_type,
    is_enabled,
    resolve_features,
)


def _baseline(training_type: str | None = None) -> dict[str, bool]:
    """解析基线：builtin→True，toggleable→default，按 training_type 过滤适用性。"""
    out: dict[str, bool] = {}
    for k, c in all_capabilities().items():
        if training_type is not None and c.training_types is not None and training_type not in c.training_types:
            continue
        out[k] = True if c.tier == "builtin" else c.default
    return out


def _expected(**overrides: bool) -> dict[str, bool]:
    return {**_baseline(), **overrides}


class TestResolveFeatures:
    def test_defaults_when_no_snapshot(self):
        result = resolve_features(None)
        assert result == _baseline()

    def test_defaults_when_empty_snapshot(self):
        result = resolve_features({})
        assert result == _baseline()

    def test_emotion_is_builtin_always_on(self):
        # 情绪为 builtin：默认开启
        assert resolve_features(None)["emotion"] is True

    def test_builtin_cannot_be_disabled_via_snapshot(self):
        # snapshot 尝试关闭 builtin 情绪，应被忽略（恒开）
        result = resolve_features({"features": {"emotion": False}})
        assert result["emotion"] is True

    def test_override_single_flag(self):
        result = resolve_features({"features": {"physical_exam": True}})
        assert result == _expected(physical_exam=True)

    def test_override_all_flags(self):
        result = resolve_features({"features": {"physical_exam": True, "patient_initiative": True}})
        assert result == _expected(physical_exam=True, patient_initiative=True, emotion=True)

    def test_requires_coupling_initiative_forces_emotion(self):
        # patient_initiative requires emotion —— 声明式耦合
        result = resolve_features({"features": {"patient_initiative": True}})
        assert result["patient_initiative"] is True
        assert result["emotion"] is True

    def test_unknown_key_ignored(self):
        result = resolve_features({"features": {"unknown_flag": True}})
        assert result == _baseline()

    def test_training_type_filtering_triage(self):
        # patient_initiative 仅 history_taking 适用；triage 解析结果不含它
        result = resolve_features(training_type="triage")
        assert "patient_initiative" not in result
        assert result["emotion"] is True  # builtin 全类型
        assert "physical_exam" in result  # triage 适用

    def test_training_type_filtering_history_taking(self):
        result = resolve_features(training_type="history_taking")
        assert "patient_initiative" in result
        assert "nursing_record" in result  # nursing_record 仅 history_taking


class TestIsEnabled:
    def test_false_by_default(self):
        record = MagicMock()
        record.practice_snapshot = None
        assert is_enabled(record, "physical_exam") is False

    def test_true_when_overridden(self):
        record = MagicMock()
        record.practice_snapshot = {"features": {"physical_exam": True}}
        assert is_enabled(record, "physical_exam") is True

    def test_emotion_builtin_enabled_by_default(self):
        record = MagicMock()
        record.practice_snapshot = None
        assert is_enabled(record, "emotion") is True

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
            assert flag.tier in ("builtin", "toggleable")

    def test_emotion_is_builtin(self):
        assert ALL_CAPABILITIES["emotion"].tier == "builtin"

    def test_initiative_requires_emotion(self):
        assert "emotion" in ALL_CAPABILITIES["patient_initiative"].requires

    def test_nursing_record_flag_exists(self):
        assert "nursing_record" in ALL_CAPABILITIES

    def test_capabilities_for_type_filters(self):
        triage = capabilities_for_type("triage")
        assert "patient_initiative" not in triage
        assert "emotion" in triage
