"""Unit tests for LLM JSON parsing — tolerance, truncation repair, extraction."""

import pytest

from infra.llm.parsing import _extract_json_value, _repair_truncated_json, safe_parse_json


class TestSafeParseJson:
    def test_plain_json(self):
        assert safe_parse_json('{"total_score": 85}') == {"total_score": 85}

    def test_think_tag_stripped(self):
        text = '<thinking>内部思考</thinking>{"total_score": 90}'
        assert safe_parse_json(text) == {"total_score": 90}

    def test_code_fence_stripped(self):
        text = '```json\n{"total_score": 88}\n```'
        assert safe_parse_json(text) == {"total_score": 88}

    def test_surrounding_text_stripped(self):
        text = '以下是评分结果：{"total_score": 77} 完毕'
        assert safe_parse_json(text) == {"total_score": 77}

    def test_trailing_comma_tolerated(self):
        text = '{"total_score": 80, "suggestions": ["a", "b",],}'
        assert safe_parse_json(text) == {"total_score": 80, "suggestions": ["a", "b"]}

    def test_truncated_object_repaired(self):
        text = '{"total_score": 82, "suggestions": ["继续观察"'  # 被截断：数组未闭合
        result = safe_parse_json(text)
        assert result["total_score"] == 82
        assert result["suggestions"] == ["继续观察"]

    def test_truncated_array_repaired(self):
        # 字符串已闭合、数组未闭合 → 全部项保留，仅补上闭合括号
        text = '{"strengths": ["沟通良好", "评估准确"], "suggestions": ["继续观察"'
        result = safe_parse_json(text)
        assert result["strengths"] == ["沟通良好", "评估准确"]
        assert result["suggestions"] == ["继续观察"]

    def test_field_extraction_from_broken_json(self):
        # 无法完整修复时仍能提取关键字段
        text = '"total_score": 65, "strengths": ["a", "b"], "suggestions": "多练习"'
        result = safe_parse_json(text)
        assert result["total_score"] == 65
        assert result["strengths"] == ["a", "b"]
        assert result["suggestions"] == "多练习"

    def test_detail_scores_extracted(self):
        text = '{"total_score": 70, "detail_scores": {"沟通": 80, "评估": 60}}'
        result = safe_parse_json(text)
        assert result["detail_scores"] == {"沟通": 80, "评估": 60}

    def test_negative_score_kept(self):
        assert safe_parse_json('{"total_score": -5}') == {"total_score": -5}

    def test_unparseable_raises(self):
        with pytest.raises(ValueError):
            safe_parse_json("完全没有 JSON 内容")

    def test_empty_string_raises(self):
        with pytest.raises(ValueError):
            safe_parse_json("")


class TestRepairTruncatedJson:
    def test_closes_open_braces(self):
        repaired = _repair_truncated_json('{"a": 1')
        assert repaired == '{"a": 1}'

    def test_closes_open_brackets(self):
        repaired = _repair_truncated_json('{"a": [1, 2')
        assert repaired == '{"a": [1, 2]}'

    def test_none_for_non_object(self):
        assert _repair_truncated_json("hello") is None

    def test_complete_json_returns_none(self):
        assert _repair_truncated_json('{"a": 1}') is None

    def test_unterminated_string_parseable_but_lossy(self):
        # 修复以“可解析”为目标：未闭合字符串的内容会被截断丢失
        import json

        repaired = _repair_truncated_json('{"a": "未闭合')
        assert json.loads(repaired) == {"a": ""}


class TestExtractJsonValue:
    def test_extracts_nested_object(self):
        obj, end = _extract_json_value('{"a": {"b": 1}} tail', 0)
        assert obj == {"a": {"b": 1}}
        assert end == 15  # raw_decode 返回结束后的下标

    def test_depth_limit_returns_none(self):
        deep = "{" * 20 + "}" * 20
        assert _extract_json_value(deep, 0) is None

    def test_invalid_json_returns_none(self):
        assert _extract_json_value("{not json}", 0) is None
