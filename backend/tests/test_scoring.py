"""Unit tests for pure functions in contexts.training.service."""

import pytest

from contexts.training.service._scoring_validation import (
    _check_feedback_empty,
    _coerce_numeric_fields,
    _convert_to_100_scale,
    _merge_feedback,
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


# ──────────────────────────────────────────────
# _validate_scoring_essentials
# ──────────────────────────────────────────────

def test_validate_scoring_essentials_passes_with_valid_data():
    _validate_scoring_essentials({"total_score": 50, "detail_scores": {"dim_a": {}}})


def test_validate_scoring_essentials_passes_with_float_total_score():
    _validate_scoring_essentials({"total_score": 50.5, "detail_scores": {}})


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
    _validate_feedback_fields({
        "strengths": ["good communication"],
        "weaknesses": ["missed detail"],
        "missed_content": ["item1"],
        "suggestions": "do better",
    })


def test_validate_feedback_fields_raises_empty_strengths():
    with pytest.raises(ValueError, match="反馈字段不完整"):
        _validate_feedback_fields({
            "strengths": [],
            "weaknesses": ["w"],
            "missed_content": ["m"],
            "suggestions": "s",
        })


def test_validate_feedback_fields_raises_empty_weaknesses():
    with pytest.raises(ValueError, match="反馈字段不完整"):
        _validate_feedback_fields({
            "strengths": ["s"],
            "weaknesses": [],
            "missed_content": ["m"],
            "suggestions": "sug",
        })


def test_validate_feedback_fields_raises_empty_missed_content():
    with pytest.raises(ValueError, match="反馈字段不完整"):
        _validate_feedback_fields({
            "strengths": ["s"],
            "weaknesses": ["w"],
            "missed_content": [],
            "suggestions": "sug",
        })


def test_validate_feedback_fields_raises_empty_suggestions():
    with pytest.raises(ValueError, match="反馈字段不完整"):
        _validate_feedback_fields({
            "strengths": ["s"],
            "weaknesses": ["w"],
            "missed_content": ["m"],
            "suggestions": "",
        })


def test_validate_feedback_fields_raises_whitespace_only_suggestions():
    with pytest.raises(ValueError, match="反馈字段不完整"):
        _validate_feedback_fields({
            "strengths": ["s"],
            "weaknesses": ["w"],
            "missed_content": ["m"],
            "suggestions": "   ",
        })


def test_validate_feedback_fields_raises_missing_field():
    with pytest.raises(ValueError, match="反馈字段不完整"):
        _validate_feedback_fields({
            "strengths": ["s"],
            "weaknesses": ["w"],
            "missed_content": ["m"],
        })


def test_validate_feedback_fields_raises_wrong_type():
    with pytest.raises(ValueError, match="反馈字段不完整"):
        _validate_feedback_fields({
            "strengths": "not a list",
            "weaknesses": ["w"],
            "missed_content": ["m"],
            "suggestions": "s",
        })


# ──────────────────────────────────────────────
# _check_feedback_empty
# ──────────────────────────────────────────────

def test_check_feedback_empty_returns_empty_list_when_all_valid():
    result = _check_feedback_empty({
        "strengths": ["s"],
        "weaknesses": ["w"],
        "missed_content": ["m"],
        "suggestions": "sug",
    })
    assert result == []


def test_check_feedback_empty_returns_strengths_when_empty_list():
    result = _check_feedback_empty({
        "strengths": [],
        "weaknesses": ["w"],
        "missed_content": ["m"],
        "suggestions": "s",
    })
    assert result == ["strengths"]


def test_check_feedback_empty_returns_weaknesses_when_empty_list():
    result = _check_feedback_empty({
        "strengths": ["s"],
        "weaknesses": [],
        "missed_content": ["m"],
        "suggestions": "s",
    })
    assert result == ["weaknesses"]


def test_check_feedback_empty_returns_missed_content_when_empty_list():
    result = _check_feedback_empty({
        "strengths": ["s"],
        "weaknesses": ["w"],
        "missed_content": [],
        "suggestions": "s",
    })
    assert result == ["missed_content"]


def test_check_feedback_empty_returns_suggestions_when_empty_string():
    result = _check_feedback_empty({
        "strengths": ["s"],
        "weaknesses": ["w"],
        "missed_content": ["m"],
        "suggestions": "",
    })
    assert result == ["suggestions"]


def test_check_feedback_empty_returns_suggestions_when_whitespace_only():
    result = _check_feedback_empty({
        "strengths": ["s"],
        "weaknesses": ["w"],
        "missed_content": ["m"],
        "suggestions": "   ",
    })
    assert result == ["suggestions"]


def test_check_feedback_empty_returns_multiple_missing():
    result = _check_feedback_empty({
        "strengths": [],
        "weaknesses": [],
        "missed_content": ["m"],
        "suggestions": "",
    })
    assert set(result) == {"strengths", "weaknesses", "suggestions"}


def test_check_feedback_empty_returns_fields_when_none():
    result = _check_feedback_empty({
        "strengths": None,
        "weaknesses": ["w"],
        "missed_content": ["m"],
        "suggestions": "s",
    })
    assert "strengths" in result


def test_check_feedback_empty_returns_all_fields_when_all_missing():
    result = _check_feedback_empty({})
    assert set(result) == {"strengths", "weaknesses", "missed_content", "suggestions"}


def test_check_feedback_empty_handles_wrong_type_for_strengths():
    result = _check_feedback_empty({
        "strengths": "not a list",
        "weaknesses": ["w"],
        "missed_content": ["m"],
        "suggestions": "s",
    })
    assert "strengths" in result


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
    first = {"strengths": [], "weaknesses": ["w1"], "missed_content": ["m1"], "suggestions": ""}
    second = {"strengths": [], "weaknesses": ["w2"], "missed_content": ["m2"], "suggestions": "  "}
    missing = ["strengths", "suggestions"]
    result = _merge_feedback(first, second, missing)
    assert result["strengths"] == []
    assert result["suggestions"] == ""


# ──────────────────────────────────────────────
# _validate_scoring_result
# ──────────────────────────────────────────────

def test_validate_scoring_result_passes_with_complete_valid_data():
    _validate_scoring_result({
        "total_score": 80,
        "detail_scores": {"dim_a": {"score": 30, "items": []}},
        "strengths": ["good"],
        "weaknesses": ["bad"],
        "missed_content": ["missed"],
        "suggestions": "do better",
    })


def test_validate_scoring_result_defaults_wrong_type_strengths_then_raises():
    result = {
        "total_score": 80,
        "detail_scores": {},
        "strengths": "not a list",
        "weaknesses": ["w"],
        "missed_content": ["m"],
        "suggestions": "s",
    }
    with pytest.raises(ValueError, match="strengths"):
        _validate_scoring_result(result)
    assert result["strengths"] == []


def test_validate_scoring_result_defaults_wrong_type_suggestions_then_raises():
    result = {
        "total_score": 80,
        "detail_scores": {},
        "strengths": ["s"],
        "weaknesses": ["w"],
        "missed_content": ["m"],
        "suggestions": 123,
    }
    with pytest.raises(ValueError, match="suggestions"):
        _validate_scoring_result(result)
    assert result["suggestions"] == ""


def test_validate_scoring_result_defaults_wrong_type_weaknesses_then_raises():
    result = {
        "total_score": 80,
        "detail_scores": {},
        "strengths": ["s"],
        "weaknesses": "wrong",
        "missed_content": ["m"],
        "suggestions": "sug",
    }
    with pytest.raises(ValueError, match="weaknesses"):
        _validate_scoring_result(result)
    assert result["weaknesses"] == []


def test_validate_scoring_result_defaults_wrong_type_missed_content_then_raises():
    result = {
        "total_score": 80,
        "detail_scores": {},
        "strengths": ["s"],
        "weaknesses": ["w"],
        "missed_content": 42,
        "suggestions": "sug",
    }
    with pytest.raises(ValueError, match="missed_content"):
        _validate_scoring_result(result)
    assert result["missed_content"] == []


def test_validate_scoring_result_leaves_correct_types_unchanged():
    result = {
        "total_score": 80,
        "detail_scores": {},
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
        _validate_scoring_result({
            "detail_scores": {},
            "strengths": ["s"],
            "weaknesses": ["w"],
            "missed_content": ["m"],
            "suggestions": "sug",
        })


def test_validate_scoring_result_raises_missing_detail_scores():
    with pytest.raises(ValueError):
        _validate_scoring_result({
            "total_score": 80,
            "strengths": ["s"],
            "weaknesses": ["w"],
            "missed_content": ["m"],
            "suggestions": "sug",
        })


def test_validate_scoring_result_raises_missing_feedback_field():
    with pytest.raises(ValueError, match="LLM评分反馈字段不完整"):
        _validate_scoring_result({
            "total_score": 80,
            "detail_scores": {},
            "weaknesses": ["w"],
            "missed_content": ["m"],
            "suggestions": "sug",
        })


def test_validate_scoring_result_raises_empty_strengths():
    with pytest.raises(ValueError, match="LLM评分反馈字段不完整"):
        _validate_scoring_result({
            "total_score": 80,
            "detail_scores": {},
            "strengths": [],
            "weaknesses": ["w"],
            "missed_content": ["m"],
            "suggestions": "sug",
        })


def test_validate_scoring_result_raises_whitespace_suggestions():
    with pytest.raises(ValueError, match="LLM评分反馈字段不完整"):
        _validate_scoring_result({
            "total_score": 80,
            "detail_scores": {},
            "strengths": ["s"],
            "weaknesses": ["w"],
            "missed_content": ["m"],
            "suggestions": "   ",
        })


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
