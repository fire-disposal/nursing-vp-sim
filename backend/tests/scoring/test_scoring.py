"""Unit tests for pure functions in modules.training.service."""

import logging

import pytest

from modules.training.scoring.validation import (
    _coerce_numeric_fields,
    _convert_to_100_scale,
    _merge_feedback,
    _missing_feedback_fields,
    _validate_feedback_fields,
    _validate_scoring_essentials,
    _validate_scoring_result,
)

# ──────────────────────────────────────────────
# _coerce_numeric_fields
# ──────────────────────────────────────────────


def test_coerce_numeric_fields_converts_int_string():
    obj = {"total_score": "42"}
    _coerce_numeric_fields(obj)
    assert obj["total_score"] == 42
    assert isinstance(obj["total_score"], int)


def test_coerce_numeric_fields_converts_float_string():
    obj = {"total_score": "3.14"}
    _coerce_numeric_fields(obj)
    assert obj["total_score"] == 3.14
    assert isinstance(obj["total_score"], float)


def test_coerce_numeric_fields_leaves_int_unchanged():
    obj = {"total_score": 42}
    _coerce_numeric_fields(obj)
    assert obj["total_score"] == 42
    assert isinstance(obj["total_score"], int)


def test_coerce_numeric_fields_leaves_float_unchanged():
    obj = {"total_score": 3.14}
    _coerce_numeric_fields(obj)
    assert obj["total_score"] == 3.14
    assert isinstance(obj["total_score"], float)


def test_coerce_numeric_fields_ignores_non_coerce_keys():
    obj = {"other_field": "hello", "count": "10"}
    _coerce_numeric_fields(obj)
    assert obj["other_field"] == "hello"
    assert obj["count"] == "10"


def test_coerce_numeric_fields_coerces_score_key():
    obj = {"score": "5"}
    _coerce_numeric_fields(obj)
    assert obj["score"] == 5


def test_coerce_numeric_fields_coerces_max_key():
    obj = {"max": "10.5"}
    _coerce_numeric_fields(obj)
    assert obj["max"] == 10.5


def test_coerce_numeric_fields_handles_nested_dict():
    obj = {
        "total_score": "80",
        "detail_scores": {
            "dim_a": {"score": "30", "max": "40"},
            "dim_b": {"score": "50.5", "max": "60"},
        },
    }
    _coerce_numeric_fields(obj)
    assert obj["total_score"] == 80
    assert obj["detail_scores"]["dim_a"]["score"] == 30
    assert obj["detail_scores"]["dim_a"]["max"] == 40
    assert obj["detail_scores"]["dim_b"]["score"] == 50.5
    assert obj["detail_scores"]["dim_b"]["max"] == 60


def test_coerce_numeric_fields_handles_list_of_dicts():
    obj = {
        "detail_scores": {
            "dim": {
                "items": [
                    {"score": "1", "max": "2"},
                    {"score": "3.5", "max": "4"},
                ],
            },
        },
    }
    _coerce_numeric_fields(obj)
    items = obj["detail_scores"]["dim"]["items"]
    assert items[0]["score"] == 1
    assert items[0]["max"] == 2
    assert items[1]["score"] == 3.5
    assert items[1]["max"] == 4


def test_coerce_numeric_fields_handles_deeply_nested():
    obj = {
        "total_score": "90",
        "detail_scores": {
            "dim1": {
                "score": "35",
                "items": [
                    {"score": "10", "nested": {"score": "5"}},
                ],
            },
        },
    }
    _coerce_numeric_fields(obj)
    assert obj["total_score"] == 90
    assert obj["detail_scores"]["dim1"]["score"] == 35
    assert obj["detail_scores"]["dim1"]["items"][0]["score"] == 10
    assert obj["detail_scores"]["dim1"]["items"][0]["nested"]["score"] == 5


def test_coerce_numeric_fields_handles_invalid_numeric_string():
    obj = {"total_score": "abc"}
    _coerce_numeric_fields(obj)
    assert obj["total_score"] == "abc"


def test_coerce_numeric_fields_handles_empty_dict():
    obj = {}
    _coerce_numeric_fields(obj)
    assert obj == {}


def test_coerce_numeric_fields_handles_empty_list():
    obj = {"items": []}
    _coerce_numeric_fields(obj)
    assert obj["items"] == []


def test_coerce_numeric_fields_mutates_in_place():
    obj = {"total_score": "42"}
    result = _coerce_numeric_fields(obj)
    assert result is None
    assert obj["total_score"] == 42


# ── 带范围批注/单位后缀的数值字符串（真实故障：模型输出 "20(0~48)"） ──


def test_coerce_numeric_fields_strips_range_annotation_on_total_score():
    obj = {"total_score": "20(0~48)"}
    _coerce_numeric_fields(obj)
    assert obj["total_score"] == 20
    assert isinstance(obj["total_score"], int)


def test_coerce_numeric_fields_strips_range_annotation_on_score():
    obj = {"score": "13(0~28)"}
    _coerce_numeric_fields(obj)
    assert obj["score"] == 13
    assert isinstance(obj["score"], int)


def test_coerce_numeric_fields_strips_range_annotation_keeping_float():
    obj = {"score": "3.14(0~2.8)"}
    _coerce_numeric_fields(obj)
    assert obj["score"] == 3.14
    assert isinstance(obj["score"], float)


def test_coerce_numeric_fields_strips_unit_suffix_on_max():
    obj = {"max": "35.5分"}
    _coerce_numeric_fields(obj)
    assert obj["max"] == 35.5
    assert isinstance(obj["max"], float)


def test_coerce_numeric_fields_strips_range_annotation_across_nested_items():
    obj = {
        "detail_scores": {
            "dim": {
                "score": "13(0~28)",
                "items": [
                    {"score": "2(0~2)", "max": "2"},
                    {"score": "1.5(0~2)", "max": "2"},
                ],
            },
        },
    }
    _coerce_numeric_fields(obj)
    dim = obj["detail_scores"]["dim"]
    assert dim["score"] == 13
    assert dim["items"][0]["score"] == 2
    assert dim["items"][0]["max"] == 2
    assert dim["items"][1]["score"] == 1.5
    assert dim["items"][1]["max"] == 2
    for key in ("score", "max"):
        assert isinstance(dim["items"][0][key], int)
        assert isinstance(dim["items"][1][key], (int, float))


def test_coerce_numeric_fields_annotation_ignored_is_logged_at_info(caplog):
    obj = {"total_score": "20(0~48)"}
    with caplog.at_level(logging.INFO, logger="modules.training.scoring.validation"):
        _coerce_numeric_fields(obj)
    assert obj["total_score"] == 20
    assert "已忽略批注/后缀" in caplog.text


def test_coerce_numeric_fields_keeps_leading_text_string(caplog):
    obj = {"score": "分20"}
    with caplog.at_level(logging.WARNING, logger="modules.training.scoring.validation"):
        _coerce_numeric_fields(obj)
    assert obj["score"] == "分20"
    assert "无法转换" in caplog.text


def test_coerce_numeric_fields_keeps_na_string(caplog):
    obj = {"total_score": "N/A", "score": "N/A", "max": "N/A"}
    with caplog.at_level(logging.WARNING, logger="modules.training.scoring.validation"):
        _coerce_numeric_fields(obj)
    assert obj == {"total_score": "N/A", "score": "N/A", "max": "N/A"}
    assert "无法转换" in caplog.text


# ──────────────────────────────────────────────
# _validate_scoring_essentials
# ──────────────────────────────────────────────


def test_validate_scoring_essentials_passes_with_valid_data():
    _validate_scoring_essentials({"total_score": 50, "detail_scores": {"dim_a": {}}})


def test_validate_scoring_essentials_passes_with_float_total_score():
    _validate_scoring_essentials({"total_score": 50.5, "detail_scores": {"dim_a": {}}})


def test_validate_scoring_essentials_raises_missing_total_score():
    with pytest.raises(ValueError, match="缺失字段: total_score"):
        _validate_scoring_essentials({"detail_scores": {}})


def test_validate_scoring_essentials_raises_wrong_total_score_type():
    with pytest.raises(TypeError, match="total_score 类型错误"):
        _validate_scoring_essentials({"total_score": "50", "detail_scores": {}})


def test_validate_scoring_essentials_raises_missing_detail_scores():
    with pytest.raises(ValueError, match="缺失字段: detail_scores"):
        _validate_scoring_essentials({"total_score": 50})


def test_validate_scoring_essentials_raises_wrong_detail_scores_type():
    with pytest.raises(TypeError, match="detail_scores 类型错误"):
        _validate_scoring_essentials({"total_score": 50, "detail_scores": [1, 2, 3]})


def test_validate_scoring_essentials_raises_detail_scores_is_string():
    with pytest.raises(TypeError, match="detail_scores 类型错误"):
        _validate_scoring_essentials({"total_score": 50, "detail_scores": "invalid"})


# ──────────────────────────────────────────────
# _validate_feedback_fields
# ──────────────────────────────────────────────


def test_validate_feedback_fields_passes_with_valid_data():
    _validate_feedback_fields(
        {
            "strengths": ["good communication"],
            "weaknesses": ["missed detail"],
            "missed_content": ["item1"],
            "suggestions": "do better",
        }
    )


def test_validate_feedback_fields_accepts_empty_strengths():
    """空数组是合法结果 —— 不得触发补全重试把它变成编造的优点。"""
    _validate_feedback_fields({"strengths": [], "weaknesses": ["w"], "missed_content": ["m"], "suggestions": "s"})


def test_validate_feedback_fields_raises_on_absent_field():
    with pytest.raises(ValueError, match="反馈字段不完整"):
        _validate_feedback_fields({"weaknesses": ["w"], "missed_content": ["m"], "suggestions": "s"})


def test_validate_feedback_fields_accepts_all_empty_forms():
    """四项全空（空数组/空串/纯空白）都是合法结果：没有不足就不编造。"""
    _validate_feedback_fields({"strengths": ["s"], "weaknesses": [], "missed_content": ["m"], "suggestions": "sug"})
    _validate_feedback_fields({"strengths": ["s"], "weaknesses": ["w"], "missed_content": [], "suggestions": "sug"})
    _validate_feedback_fields({"strengths": ["s"], "weaknesses": ["w"], "missed_content": ["m"], "suggestions": ""})
    _validate_feedback_fields({"strengths": ["s"], "weaknesses": ["w"], "missed_content": ["m"], "suggestions": "   "})
    _validate_feedback_fields({"strengths": [], "weaknesses": [], "missed_content": [], "suggestions": ""})


def test_validate_feedback_fields_raises_missing_field():
    with pytest.raises(ValueError, match="反馈字段不完整"):
        _validate_feedback_fields(
            {
                "strengths": ["s"],
                "weaknesses": ["w"],
                "missed_content": ["m"],
            }
        )


def test_validate_feedback_fields_raises_wrong_type():
    with pytest.raises(ValueError, match="反馈字段不完整"):
        _validate_feedback_fields(
            {
                "strengths": "not a list",
                "weaknesses": ["w"],
                "missed_content": ["m"],
                "suggestions": "s",
            }
        )


# ──────────────────────────────────────────────
# _missing_feedback_fields（空反馈合法：只有缺失/类型错误才算不完整）
# ──────────────────────────────────────────────


def test_missing_feedback_fields_empty_when_all_present():
    result = _missing_feedback_fields(
        {"strengths": ["s"], "weaknesses": ["w"], "missed_content": ["m"], "suggestions": "sug"}
    )
    assert result == []


def test_missing_feedback_fields_treats_empty_lists_as_legal():
    """没有明确不足/漏问是真实结果，不得触发补全重试。"""
    result = _missing_feedback_fields({"strengths": [], "weaknesses": [], "missed_content": [], "suggestions": ""})
    assert result == []


def test_missing_feedback_fields_reports_absent_field():
    result = _missing_feedback_fields({"weaknesses": ["w"], "missed_content": ["m"], "suggestions": "s"})
    assert result == ["strengths(缺失)"]


def test_missing_feedback_fields_reports_wrong_type():
    result = _missing_feedback_fields(
        {"strengths": "not a list", "weaknesses": ["w"], "missed_content": ["m"], "suggestions": "s"}
    )
    assert result == ["strengths(类型错误)"]


def test_missing_feedback_fields_reports_all_absent():
    result = _missing_feedback_fields({})
    assert set(result) == {"strengths(缺失)", "weaknesses(缺失)", "missed_content(缺失)", "suggestions(缺失)"}


# ──────────────────────────────────────────────
# _merge_feedback
# ──────────────────────────────────────────────


def test_merge_feedback_merges_missing_fields():
    first = {
        "strengths": [],
        "weaknesses": ["w1"],
        "missed_content": ["m1"],
        "suggestions": "",
    }
    second = {
        "strengths": ["s2"],
        "weaknesses": ["w2"],
        "missed_content": ["m2"],
        "suggestions": "sug2",
    }
    missing = ["strengths", "suggestions"]
    result = _merge_feedback(first, second, missing)
    assert result["strengths"] == ["s2"]
    assert result["suggestions"] == "sug2"


def test_merge_feedback_preserves_existing_valid_fields():
    first = {
        "strengths": ["keep_me"],
        "weaknesses": ["w1"],
        "missed_content": [],
        "suggestions": "keep_sug",
    }
    second = {
        "strengths": ["overwrite"],
        "weaknesses": ["w2"],
        "missed_content": ["m2"],
        "suggestions": "new_sug",
    }
    missing = ["missed_content"]
    result = _merge_feedback(first, second, missing)
    assert result["strengths"] == ["keep_me"]
    assert result["suggestions"] == "keep_sug"
    assert result["missed_content"] == ["m2"]


def test_merge_feedback_does_not_merge_fields_not_in_missing():
    first = {"strengths": [], "weaknesses": ["w1"], "missed_content": ["m1"], "suggestions": ""}
    second = {"strengths": ["s2"], "weaknesses": ["w2"], "missed_content": ["m2"], "suggestions": "sug2"}
    missing = ["strengths"]
    result = _merge_feedback(first, second, missing)
    assert result["weaknesses"] == ["w1"]
    assert result["missed_content"] == ["m1"]
    assert result["suggestions"] == ""


def test_merge_feedback_returns_copy_not_mutate_input():
    first = {"strengths": [], "weaknesses": ["w1"], "missed_content": ["m1"], "suggestions": ""}
    second = {"strengths": ["s2"], "weaknesses": ["w2"], "missed_content": ["m2"], "suggestions": "sug2"}
    missing = ["strengths"]
    result = _merge_feedback(first, second, missing)
    assert first["strengths"] == []
    assert result is not first


def test_merge_feedback_handles_empty_second_values():
    """补全轮返回空数组/空串时原样采用 —— 空值是合法结果，不再被当成"仍缺失"。"""
    first = {"strengths": [], "weaknesses": ["w1"], "missed_content": ["m1"], "suggestions": ""}
    second = {"strengths": [], "weaknesses": ["w2"], "missed_content": ["m2"], "suggestions": "  "}
    missing = ["strengths", "suggestions"]
    result = _merge_feedback(first, second, missing)
    assert result["strengths"] == []
    assert result["suggestions"].strip() == ""


# ──────────────────────────────────────────────
# _validate_scoring_result
# ──────────────────────────────────────────────


def test_validate_scoring_result_passes_with_complete_valid_data():
    _validate_scoring_result(
        {
            "total_score": 80,
            "detail_scores": {"dim_a": {"score": 30, "items": []}},
            "strengths": ["good"],
            "weaknesses": ["bad"],
            "missed_content": ["missed"],
            "suggestions": "do better",
        }
    )


def test_validate_scoring_result_defaults_wrong_type_strengths_then_raises():
    result = {
        "total_score": 80,
        "detail_scores": {"dim": {"items": []}},
        "strengths": "not a list",
        "weaknesses": ["w"],
        "missed_content": ["m"],
        "suggestions": "s",
    }
    _validate_scoring_result(result)
    assert result["strengths"] == []


def test_validate_scoring_result_defaults_wrong_type_suggestions_then_raises():
    result = {
        "total_score": 80,
        "detail_scores": {"dim": {"items": []}},
        "strengths": ["s"],
        "weaknesses": ["w"],
        "missed_content": ["m"],
        "suggestions": 123,
    }
    _validate_scoring_result(result)
    assert result["suggestions"] == ""


def test_validate_scoring_result_defaults_wrong_type_weaknesses_then_raises():
    result = {
        "total_score": 80,
        "detail_scores": {"dim": {"items": []}},
        "strengths": ["s"],
        "weaknesses": "wrong",
        "missed_content": ["m"],
        "suggestions": "sug",
    }
    _validate_scoring_result(result)
    assert result["weaknesses"] == []


def test_validate_scoring_result_defaults_wrong_type_missed_content_then_raises():
    result = {
        "total_score": 80,
        "detail_scores": {"dim": {"items": []}},
        "strengths": ["s"],
        "weaknesses": ["w"],
        "missed_content": 42,
        "suggestions": "sug",
    }
    _validate_scoring_result(result)
    assert result["missed_content"] == []


def test_validate_scoring_result_leaves_correct_types_unchanged():
    result = {
        "total_score": 80,
        "detail_scores": {"dim": {"items": []}},
        "strengths": ["s"],
        "weaknesses": ["w"],
        "missed_content": ["m"],
        "suggestions": "sug",
    }
    _validate_scoring_result(result)
    assert result["strengths"] == ["s"]
    assert result["weaknesses"] == ["w"]
    assert result["missed_content"] == ["m"]
    assert result["suggestions"] == "sug"


def test_validate_scoring_result_raises_missing_total_score():
    with pytest.raises(ValueError):
        _validate_scoring_result(
            {
                "detail_scores": {},
                "strengths": ["s"],
                "weaknesses": ["w"],
                "missed_content": ["m"],
                "suggestions": "sug",
            }
        )


def test_validate_scoring_result_raises_missing_detail_scores():
    with pytest.raises(ValueError):
        _validate_scoring_result(
            {
                "total_score": 80,
                "strengths": ["s"],
                "weaknesses": ["w"],
                "missed_content": ["m"],
                "suggestions": "sug",
            }
        )


def test_validate_scoring_result_raises_missing_feedback_field():
    result = {
        "total_score": 80,
        "detail_scores": {"dim": {"items": []}},
        "weaknesses": ["w"],
        "missed_content": ["m"],
        "suggestions": "sug",
    }
    _validate_scoring_result(result)
    assert result["strengths"] == []


def test_validate_scoring_result_raises_empty_strengths():
    result = {
        "total_score": 80,
        "detail_scores": {"dim": {"items": []}},
        "strengths": [],
        "weaknesses": ["w"],
        "missed_content": ["m"],
        "suggestions": "sug",
    }
    _validate_scoring_result(result)


def test_validate_scoring_result_raises_whitespace_suggestions():
    result = {
        "total_score": 80,
        "detail_scores": {"dim": {"items": []}},
        "strengths": ["s"],
        "weaknesses": ["w"],
        "missed_content": ["m"],
        "suggestions": "   ",
    }
    _validate_scoring_result(result)


# ──────────────────────────────────────────────
# _convert_to_100_scale
# ──────────────────────────────────────────────


def test_convert_to_100_scale_converts_total_score():
    result = {"total_score": 50, "detail_scores": {}}
    _convert_to_100_scale(result, raw_max=57)
    assert result["total_score"] == round(50 * 100 / 57)


def test_convert_to_100_scale_noop_when_raw_max_is_100():
    result = {"total_score": 75, "detail_scores": {}}
    _convert_to_100_scale(result, raw_max=100)
    assert result["total_score"] == 75


def test_convert_to_100_scale_noop_when_raw_max_zero():
    result = {"total_score": 50, "detail_scores": {}}
    _convert_to_100_scale(result, raw_max=0)
    assert result["total_score"] == 50


def test_convert_to_100_scale_noop_when_raw_max_negative():
    result = {"total_score": 50, "detail_scores": {}}
    _convert_to_100_scale(result, raw_max=-5)
    assert result["total_score"] == 50


def test_convert_to_100_scale_converts_nested_detail_scores():
    result = {
        "total_score": 30,
        "detail_scores": {
            "dim_a": {"score": 15, "max": 20},
            "dim_b": {"score": 15, "max": 37},
        },
    }
    _convert_to_100_scale(result, raw_max=57)
    assert result["detail_scores"]["dim_a"]["score"] == round(15 * 100 / 57)
    assert result["detail_scores"]["dim_a"]["max"] == round(20 * 100 / 57)
    assert result["detail_scores"]["dim_b"]["score"] == round(15 * 100 / 57)
    assert result["detail_scores"]["dim_b"]["max"] == round(37 * 100 / 57)


def test_convert_to_100_scale_handles_empty_detail_scores():
    result = {"total_score": 50, "detail_scores": {}}
    _convert_to_100_scale(result, raw_max=57)
    assert result["total_score"] == round(50 * 100 / 57)
    assert result["detail_scores"] == {}


def test_convert_to_100_scale_handles_missing_detail_scores():
    result = {"total_score": 50}
    _convert_to_100_scale(result, raw_max=57)
    assert result["total_score"] == round(50 * 100 / 57)


def test_convert_to_100_scale_rounds_correctly():
    result = {"total_score": 33, "detail_scores": {}}
    _convert_to_100_scale(result, raw_max=57)
    assert result["total_score"] == round(33 * 100 / 57)
    assert isinstance(result["total_score"], int)


def test_convert_to_100_scale_converts_detail_scores_with_missing_keys():
    result = {
        "total_score": 30,
        "detail_scores": {
            "dim_a": {"score": 15},
            "dim_b": {"max": 37},
            "dim_c": {},
        },
    }
    _convert_to_100_scale(result, raw_max=57)
    assert result["detail_scores"]["dim_a"]["score"] == round(15 * 100 / 57)
    assert result["detail_scores"]["dim_a"].get("max", 0) == 0
    assert result["detail_scores"]["dim_b"]["max"] == round(37 * 100 / 57)
    assert result["detail_scores"]["dim_b"].get("score", 0) == 0


def test_convert_to_100_scale_mutates_in_place_returns_none():
    result = {"total_score": 50, "detail_scores": {}}
    ret = _convert_to_100_scale(result, raw_max=57)
    assert ret is None
