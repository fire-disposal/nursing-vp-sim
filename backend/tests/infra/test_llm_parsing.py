"""Unit tests for LLM JSON parsing — tolerance, truncation repair, extraction."""

import json

import pytest

from infra.llm.parsing import (
    TruncatedJSONError,
    _extract_json_value,
    _repair_truncated_json,
    safe_parse_json,
)


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

    def test_unterminated_string_without_fallback_returns_none(self):
        """字符串内部被截断、且它是第一个键：没有可回退的边界 → 不返回候选（让上层判截断）。"""
        assert _repair_truncated_json('{"a": "未闭合') is None

    def test_unterminated_string_drops_whole_property(self):
        """字符串内部被截断但有前序键：丢掉这个不完整的键，绝不补成空串。

        旧实现返回 ``{"a": 1, "b": ""}``——给结果塞一个凭空出现的空值，
        与"不伪造状态"的原则冲突（2026-09-27 修复）。
        """
        repaired = _repair_truncated_json('{"a": 1, "b": "未闭合')
        assert repaired == '{"a": 1}'
        assert json.loads(repaired) == {"a": 1}

    def test_repair_result_must_be_parseable(self):
        """补完必须自身可解析：旧实现返回过不能解析的串，三层兜底因此一起失效。"""
        cases = [
            '{"total_score": 20, "detail_scores": {"d": {"items": [{"id": "c1", "score": 2}]}}',
            '{"a": [1, 2',
            '{"a": 1',
        ]
        for text in cases:
            repaired = _repair_truncated_json(text)
            assert repaired is not None, text
            json.loads(repaired)  # 不抛即通过

    def test_string_content_does_not_confuse_brace_count(self):
        """串内的引号/花括号不得影响计数（真实故障：长中文串里的 \\" 让括号数错位）。"""
        text = '{"reason": "学生说了 \\"你好\\" 还有 {花括号}", "score": 2'
        repaired = _repair_truncated_json(text)
        assert repaired == text + "}"
        assert json.loads(repaired)["score"] == 2


class TestTruncationClassification:
    """截断必须与"根本不是 JSON"分开：前者要压缩输出后重试，后者重试无用。

    2026-09-27 真实故障：模型输出只缺最外层一个 ``}``，旧补全逻辑因括号计数错位
    （长中文串里的 ``\\"`` 带偏）返回了自身都解析不了的串，三层兜底一起失效，
    最终被当成"模型返回空"而落 0 分。
    """

    def test_observed_truncation_shape_is_repaired(self):
        text = (
            '{"total_score": 20, "detail_scores": {"沟通技能": {"score": 13, "items":'
            ' [{"id": "comm_01", "name": "打招呼", "score": 2, "evidence": "学生：\\"您好\\"",'
            ' "reason": "主动问候"}]}'
        )
        result = safe_parse_json(text)
        assert result["total_score"] == 20
        items = result["detail_scores"]["沟通技能"]["items"]
        assert items[0]["score"] == 2
        assert items[0]["reason"] == "主动问候"

    def test_truncated_inside_string_is_classified(self):
        with pytest.raises(TruncatedJSONError):
            safe_parse_json('{"total_score": "20(0~4')

    def test_non_json_is_not_classified_as_truncation(self):
        with pytest.raises(ValueError) as exc:
            safe_parse_json("完全没有 JSON 内容")
        assert not isinstance(exc.value, TruncatedJSONError)

    def test_truncated_error_keeps_valueerror_contract(self):
        # 既有调用方一律 except ValueError —— 新增分类不改变它们的捕获行为
        assert issubclass(TruncatedJSONError, ValueError)


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
