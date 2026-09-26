"""病例生成的纯逻辑判据：用量累计与逐字段白名单（无需数据库）。"""

from __future__ import annotations

import pytest

from modules.cases.generation import _accumulate_usage
from modules.cases.prompts import KNOWN_GENERATION_FIELDS


class TestAccumulateUsage:
    def test_sums_numeric_keys_across_calls(self) -> None:
        trace = {"usage": {}, "warnings": []}
        _accumulate_usage(trace, {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150})
        _accumulate_usage(trace, {"prompt_tokens": 20, "completion_tokens": 30, "total_tokens": 50})
        assert trace["usage"] == {
            "prompt_tokens": 120,
            "completion_tokens": 80,
            "total_tokens": 200,
        }

    def test_ignores_non_numeric_and_missing_usage(self) -> None:
        trace = {"usage": {}, "warnings": []}
        _accumulate_usage(trace, None)
        _accumulate_usage(trace, {"model": "deepseek-chat", "prompt_tokens": 5})
        assert trace["usage"] == {"prompt_tokens": 5}


class TestGenerationFieldWhitelist:
    """逐字段生成只接受已知路径：未知路径此前会回退到通用提示词并照样写入 case_data。"""

    @pytest.mark.parametrize(
        "field",
        ["present_illness", "chief_complaint", "personality", "activities.physical_exam.config"],
    )
    def test_known_paths_are_allowed(self, field: str) -> None:
        assert field in KNOWN_GENERATION_FIELDS

    @pytest.mark.parametrize("field", ["foo", "activities", "patient_info.age", "exam_anchors"])
    def test_unknown_or_retired_paths_are_rejected(self, field: str) -> None:
        assert field not in KNOWN_GENERATION_FIELDS
