"""Unit tests for data-driven capability detection (tools enabled by case_data content)."""

from types import SimpleNamespace

from modules.training.capabilities import (
    _is_non_empty,
    _resolve_path,
    all_bindings,
    detect_capabilities,
    is_enabled,
)

TOOL_NAMES = {"quiz", "physical_exam", "nursing_record", "nursing_diagnosis"}


def _record(case_data: dict | None, features: dict | None = None, training_type: str = "history_taking"):
    return SimpleNamespace(
        case_snapshot=case_data,
        practice_snapshot={"features": features} if features is not None else {},
        training_type=training_type,
    )


class TestAllBindings:
    def test_registry_covers_four_tools(self):
        bindings = all_bindings()
        assert {b.tool for b in bindings} == TOOL_NAMES

    def test_bindings_have_key_property(self):
        for b in all_bindings():
            assert b.key == b.tool


class TestDetectCapabilities:
    def test_empty_case_disables_all_tools(self):
        result = detect_capabilities(None)
        assert all(result[t] is False for t in TOOL_NAMES)

    def test_tool_config_enables_tool(self):
        result = detect_capabilities({"tools": {"quiz": {"questions": []}}})
        assert result["quiz"] is True

    def test_empty_tool_config_disables_tool(self):
        result = detect_capabilities({"tools": {"quiz": {}}})
        assert result["quiz"] is False

    def test_legacy_field_enables_tool(self):
        result = detect_capabilities({"exam_anchors": [{"hr": 70}]})
        assert result["physical_exam"] is True

    def test_builtins_always_enabled_by_default(self):
        result = detect_capabilities({})
        assert result["emotion"] is True
        assert result["patient_initiative"] is True
        assert result["inquiry_progress"] is True

    def test_features_force_disable_builtin(self):
        result = detect_capabilities({}, overrides={"emotion": False})
        assert result["emotion"] is False

    def test_overrides_can_force_disable_tool(self):
        result = detect_capabilities(
            {"tools": {"quiz": {"questions": []}}},
            overrides={"quiz": False},
        )
        assert result["quiz"] is False

    def test_overrides_can_force_enable_without_data(self):
        result = detect_capabilities({}, overrides={"quiz": True})
        assert result["quiz"] is True

    def test_non_bool_override_ignored(self):
        result = detect_capabilities({}, overrides={"quiz": "yes"})
        assert result["quiz"] is False


class TestIsEnabled:
    def test_enabled_from_data(self):
        assert is_enabled(_record({"tools": {"quiz": {"questions": []}}}), "quiz") is True

    def test_disabled_without_data(self):
        assert is_enabled(_record({}), "quiz") is False

    def test_disabled_by_features_override(self):
        rec = _record({"tools": {"quiz": {"questions": []}}}, features={"quiz": False})
        assert is_enabled(rec, "quiz") is False

    def test_builtin_enabled_by_default(self):
        assert is_enabled(_record({}), "emotion") is True

    def test_builtin_disabled_by_features(self):
        rec = _record({}, features={"emotion": False})
        assert is_enabled(rec, "emotion") is False

    def test_unknown_key_false(self):
        assert is_enabled(_record({}), "nope") is False


class TestResolvePath:
    def test_nested_path(self):
        assert _resolve_path({"a": {"b": {"c": 1}}}, "a.b.c") == 1

    def test_missing_returns_none(self):
        assert _resolve_path({"a": 1}, "a.b") is None

    def test_non_dict_intermediate_returns_none(self):
        assert _resolve_path({"a": 5}, "a.b") is None


class TestIsNonEmpty:
    def test_values(self):
        assert _is_non_empty(None) is False
        assert _is_non_empty(val=True) is True
        assert _is_non_empty(val=False) is False
        assert _is_non_empty(0) is True
        assert _is_non_empty("") is False
        assert _is_non_empty("x") is True
        assert _is_non_empty([]) is False
        assert _is_non_empty([1]) is True
        assert _is_non_empty({}) is False
        assert _is_non_empty({"a": 1}) is True
