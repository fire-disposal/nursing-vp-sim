from unittest.mock import MagicMock

from contexts.training.capabilities import (
    ALL_CAPABILITIES,
    capabilities_for_type,
    detect_capabilities,
    is_enabled,
)


class TestDetectCapabilities:
    def test_defaults_empty_case_data(self):
        result = detect_capabilities(case_data={}, training_type="history_taking")
        assert result["emotion"] is True  # builtin always on
        assert result["nursing_record"] is True  # always on for history_taking
        assert result["quiz"] is False  # no quiz data
        assert result["physical_exam"] is False  # no exam_anchors
        assert result["patient_initiative"] is False  # personality default = no initiative

    def test_quiz_detected_from_data(self):
        case_data = {"quiz": {"questions": [{"id": "q1"}]}}
        result = detect_capabilities(case_data=case_data, training_type="history_taking")
        assert result["quiz"] is True

    def test_quiz_empty_questions_not_detected(self):
        case_data = {"quiz": {"questions": []}}
        result = detect_capabilities(case_data=case_data, training_type="history_taking")
        assert result["quiz"] is False

    def test_physical_exam_detected_from_anchors(self):
        case_data = {"exam_anchors": {"head": {}}}
        result = detect_capabilities(case_data=case_data, training_type="history_taking")
        assert result["physical_exam"] is True

    def test_physical_exam_not_in_triage(self):
        result = detect_capabilities(case_data={}, training_type="triage")
        assert "physical_exam" not in result  # only history_taking
        assert result["mews"] is True  # triage primary tool

    def test_initiative_detected_from_anxious(self):
        case_data = {"personality": {"anxiety_trait": "anxious"}}
        result = detect_capabilities(case_data=case_data, training_type="history_taking")
        assert result["patient_initiative"] is True

    def test_initiative_detected_from_low_patience(self):
        case_data = {"personality": {"patience": "low"}}
        result = detect_capabilities(case_data=case_data, training_type="history_taking")
        assert result["patient_initiative"] is True

    def test_initiative_normal_personality_false(self):
        case_data = {"personality": {"anxiety_trait": "normal", "patience": "normal"}}
        result = detect_capabilities(case_data=case_data, training_type="history_taking")
        assert result["patient_initiative"] is False

    def test_mews_always_on_for_triage(self):
        result = detect_capabilities(case_data={}, training_type="triage")
        assert result["mews"] is True

    def test_mews_off_for_history_taking(self):
        result = detect_capabilities(case_data={}, training_type="history_taking")
        assert "mews" not in result

    def test_overrides_can_disable(self):
        case_data = {}
        result = detect_capabilities(
            case_data=case_data, training_type="history_taking", overrides={"nursing_record": False}
        )
        assert result["nursing_record"] is False

    def test_overrides_cannot_enable_without_data(self):
        case_data = {}
        result = detect_capabilities(case_data=case_data, training_type="history_taking", overrides={"quiz": True})
        assert result["quiz"] is False  # no quiz data → can't force enable

    def test_requires_coupling(self):
        case_data = {"personality": {"anxiety_trait": "anxious"}}
        result = detect_capabilities(case_data=case_data, training_type="history_taking")
        assert result["patient_initiative"] is True
        assert result["emotion"] is True  # forced by requires

    def test_training_type_filtering(self):
        result = detect_capabilities(case_data={}, training_type="triage")
        assert "patient_initiative" not in result  # only history_taking
        assert "nursing_record" not in result  # only history_taking
        assert result["emotion"] is True  # builtin for all types


class TestIsEnabled:
    def test_false_when_no_data(self):
        record = MagicMock()
        record.practice_snapshot = None
        record.case_snapshot = {}
        record.training_type = "history_taking"
        assert is_enabled(record, "quiz") is False

    def test_true_when_data_present(self):
        record = MagicMock()
        record.practice_snapshot = None
        record.case_snapshot = {"quiz": {"questions": [{"id": "q1"}]}}
        record.training_type = "history_taking"
        assert is_enabled(record, "quiz") is True

    def test_emotion_builtin_always_enabled(self):
        record = MagicMock()
        record.practice_snapshot = None
        record.case_snapshot = {}
        record.training_type = "history_taking"
        assert is_enabled(record, "emotion") is True

    def test_override_can_disable(self):
        record = MagicMock()
        record.practice_snapshot = {"features": {"nursing_record": False}}
        record.case_snapshot = {}
        record.training_type = "history_taking"
        assert is_enabled(record, "nursing_record") is False

    def test_unknown_key_returns_false(self):
        record = MagicMock()
        record.practice_snapshot = None
        record.case_snapshot = {}
        record.training_type = "history_taking"
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

    def test_capabilities_for_type_filters(self):
        triage = capabilities_for_type("triage")
        assert "patient_initiative" not in triage
        assert "emotion" in triage
