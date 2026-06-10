"""Unit tests for exam handler and exam-emotion bridge."""
import pytest
from contexts.patient.exam import detect_operation, handle_operation


class TestDetectOperation:
    def test_detect_bp_slash(self):
        assert detect_operation("/bp") == "bp"
        assert detect_operation("/血压") == "bp"
        assert detect_operation("测血压") == "bp"

    def test_detect_temp(self):
        assert detect_operation("/temp") == "temp"
        assert detect_operation("测体温") == "temp"

    def test_detect_vitals(self):
        assert detect_operation("/vitals") == "vitals"

    def test_detect_hr(self):
        assert detect_operation("/hr") == "hr"
        assert detect_operation("测心率") == "hr"

    def test_detect_spo2(self):
        assert detect_operation("/spo2") == "spo2"
        assert detect_operation("测血氧") == "spo2"

    def test_detect_rr(self):
        assert detect_operation("/rr") == "rr"

    def test_detect_skin(self):
        assert detect_operation("/skin") == "skin"
        assert detect_operation("观察皮肤") == "skin"

    def test_detect_pain(self):
        assert detect_operation("/pain") == "pain"
        assert detect_operation("疼痛评分") == "pain"

    def test_no_match(self):
        assert detect_operation("你今天感觉怎么样") is None
        assert detect_operation("") is None

    def test_case_insensitive(self):
        assert detect_operation("/BP") == "bp"
        assert detect_operation("/Bp") == "bp"


class TestHandleOperation:
    def test_handle_without_anchors(self):
        result = handle_operation("bp", {})
        assert result["type"] == "info"
        assert "未配置" in str(result.get("value", ""))

    def test_handle_with_vital_signs(self):
        case_data = {
            "exam_anchors": {
                "vital_signs": {
                    "temperature": "36.5-37.2",
                    "blood_pressure": "118-128/76-84",
                    "heart_rate": "68-82",
                    "spo2": "96-99",
                    "respiratory_rate": "14-18",
                }
            }
        }
        result = handle_operation("bp", case_data)
        assert result["label"] == "血压"
        assert result["unit"] == "mmHg"
        assert result["type"] == "vitals"
        assert "-" in str(result.get("value", "")) or "/" in str(result.get("value", ""))

    def test_handle_skin(self):
        case_data = {"exam_anchors": {"skin": "未见明显异常"}}
        result = handle_operation("skin", case_data)
        assert result["label"] == "皮肤"

    def test_handle_pain_no_anchors(self):
        case_data = {}
        result = handle_operation("pain", case_data)
        assert result["type"] == "info"
        assert "未配置" in str(result.get("value", ""))

    def test_handle_vitals_summary(self):
        case_data = {
            "exam_anchors": {
                "vital_signs": {
                    "temperature": "37.0",
                    "heart_rate": "80",
                    "blood_pressure": "130/85",
                    "spo2": "98",
                }
            }
        }
        result = handle_operation("vitals", case_data)
        assert result["label"] == "生命体征"
        assert "体温" in result.get("value", "")


class TestExamEmotionImpact:
    def test_impact_mapping_exists(self):
        from contexts.training.plugins import EXAM_EMOTION_IMPACT
        assert "temp" in EXAM_EMOTION_IMPACT
        assert "skin" in EXAM_EMOTION_IMPACT
        assert "vitals" in EXAM_EMOTION_IMPACT
        for op, impact in EXAM_EMOTION_IMPACT.items():
            assert "category" in impact
            assert "trust_no" in impact
            assert "comfort_no" in impact

    def test_cumulative_thresholds(self):
        from contexts.training.plugins import _CUMULATIVE_THRESHOLDS
        assert len(_CUMULATIVE_THRESHOLDS) == 3
        for threshold, dt, dc in _CUMULATIVE_THRESHOLDS:
            assert threshold > 0
            assert isinstance(dt, int)
            assert isinstance(dc, int)
