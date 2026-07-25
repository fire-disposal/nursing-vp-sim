"""Tests for physical exam operation handler and age-adaptive defaults."""

from profiles.history_taking.exam import (
    _format_skin,
    _get_age_group,
    _get_default,
    _resolve_bp,
    _resolve_range,
    handle_operation,
)


class TestAgeGroup:
    def test_pediatric(self):
        assert _get_age_group({"patient_info": {"age": 3}}) == "pediatric"
        assert _get_age_group({"patient_info": {"age": 12}}) == "pediatric"

    def test_adult(self):
        assert _get_age_group({"patient_info": {"age": 13}}) == "adult"
        assert _get_age_group({"patient_info": {"age": 30}}) == "adult"
        assert _get_age_group({"patient_info": {"age": 64}}) == "adult"

    def test_elderly(self):
        assert _get_age_group({"patient_info": {"age": 65}}) == "elderly"
        assert _get_age_group({"patient_info": {"age": 80}}) == "elderly"

    def test_missing_age_defaults_to_adult(self):
        assert _get_age_group({}) == "adult"
        assert _get_age_group({"patient_info": {}}) == "adult"


class TestResolveRange:
    def test_simple_range(self):
        assert _resolve_range("36.8-37.2") == "37.0"

    def test_fixed_value(self):
        assert _resolve_range("36.8") == "36.8"

    def test_bp_range(self):
        result = _resolve_range("120/80-130/85")
        assert "125" in result
        assert "83" in result or "82" in result

    def test_empty(self):
        assert _resolve_range("") == ""


class TestResolveBP:
    def test_bp_midpoint(self):
        result = _resolve_bp("120/80-130/85")
        assert result in ("125/83", "125/82")

    def test_bp_odd_rounding(self):
        result = _resolve_bp("110/70-120/80")
        assert result in ("115/75",)


class TestFormatSkin:
    def test_string(self):
        assert _format_skin("皮肤温暖") == "皮肤温暖"

    def test_dict_returns_first_value(self):
        assert _format_skin({"right_foot": "溃烂创面", "left_foot": ""}) == "溃烂创面"

    def test_empty_dict_returns_none(self):
        assert _format_skin({}) is None

    def test_none_returns_none(self):
        assert _format_skin(None) is None


class TestGetDefault:
    def test_adult_temp(self):
        val = _get_default("temp", {"patient_info": {"age": 30}})
        assert float(val) > 36
        assert float(val) < 38

    def test_pediatric_hr_higher(self):
        adult = float(_get_default("hr", {"patient_info": {"age": 30}}))
        pediatric = float(_get_default("hr", {"patient_info": {"age": 5}}))
        assert pediatric > adult

    def test_elderly_bp_higher(self):
        adult = _get_default("bp", {"patient_info": {"age": 30}})
        elderly = _get_default("bp", {"patient_info": {"age": 70}})
        adult_sys = int(adult.split("/")[0])
        elderly_sys = int(elderly.split("/")[0])
        assert elderly_sys >= adult_sys

    def test_pain_defaults_to_zero(self):
        assert _get_default("pain", {}) == "0"

    def test_skin_default(self):
        assert "未见" in _get_default("skin", {})


class TestHandleOperation:
    def test_vital_from_exam_anchors(self):
        """Temperature resolved from exam_anchors.vital_signs."""
        case = {"exam_anchors": {"vital_signs": {"temperature": "36.8-37.2"}}}
        result = handle_operation("temp", case)
        assert result["value"] == "37.0"

    def test_vital_fallback_to_age_default(self):
        """HR falls back to age-appropriate default when not in exam_anchors."""
        case = {
            "exam_anchors": {"vital_signs": {}},  # no heart_rate
            "patient_info": {"age": 30},
        }
        result = handle_operation("hr", case)
        assert result["value"] != "—"
        assert float(result["value"]) > 50  # reasonable adult HR

    def test_skin_from_dict(self):
        """Skin inspection reads first value from nested dict."""
        case = {"exam_anchors": {"skin": {"right_foot": "右足底溃烂创面", "left_foot": ""}}}
        result = handle_operation("skin", case)
        assert "溃烂" in result["value"]

    def test_skin_fallback(self):
        """Skin falls back to default when not configured."""
        case = {"exam_anchors": {"vital_signs": {}}}
        result = handle_operation("skin", case)
        assert "未见" in result["value"]

    def test_pain_from_vital_signs_subpath(self):
        """Pain resolved from exam_anchors.vital_signs.pain_score."""
        case = {"exam_anchors": {"vital_signs": {"pain_score": "4-6"}}}
        result = handle_operation("pain", case)
        assert "4" in result["value"] or "6" in result["value"] or result["value"] != "0"

    def test_pain_from_top_level(self):
        """Pain resolved from exam_anchors.pain_score (top-level)."""
        case = {"exam_anchors": {"pain_score": 3}}
        result = handle_operation("pain", case)
        assert result["value"] == "3"

    def test_pain_fallback(self):
        """Pain falls back to 0 when not configured."""
        case = {"exam_anchors": {"vital_signs": {}}}
        result = handle_operation("pain", case)
        assert result["value"] == "0"

    def test_groups_format(self):
        """Groups format resolves vital signs correctly."""
        case = {
            "exam_anchors": {
                "groups": [
                    {
                        "ops": [
                            {"id": "temp", "label": "体温", "unit": "°C", "source": "vital_signs.temperature"},
                            {"id": "custom_op", "label": "自定义", "unit": "", "source": "skin"},
                        ]
                    }
                ],
                "vital_signs": {"temperature": "37.0"},
                "skin": "皮肤正常",
            }
        }
        result = handle_operation("temp", case)
        assert result["value"] == "37.0"

        result = handle_operation("custom_op", case)
        assert "正常" in result["value"]

    def test_groups_fallback_to_default(self):
        """Groups-defined op falls back to default when source not configured."""
        case = {
            "exam_anchors": {
                "groups": [
                    {
                        "ops": [
                            {"id": "temp", "label": "体温", "unit": "°C", "source": "vital_signs.temperature"},
                        ]
                    }
                ],
                "patient_info": {"age": 5},
            }
        }
        result = handle_operation("temp", case)
        val = float(result["value"])
        assert val > 36
        assert val < 38
