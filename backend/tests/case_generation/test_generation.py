"""生成服务测试：两阶段、修复循环、字段模式、校验。"""

from types import SimpleNamespace
from typing import Any, cast

from infra.llm.client import LLMClient
from models import User
from modules.cases.generation import (
    _validate_core_stage,
    _validate_derivative_stage,
)
from schemas import CaseGenerateRequest

USER = cast("User", SimpleNamespace(id=1))

VALID_CORE = {
    "name": "肺炎患者的护理",
    "difficulty": 1,
    "time_limit": 20,
    "description": "训练目标",
    "patient_info": {"name": "王大爷", "age": 65, "gender": "男"},
    "chief_complaint": "咳嗽伴发热3天",
    "opening_line": "我这几天一直咳嗽。",
    "present_illness": "3天前受凉后出现咳嗽",
    "past_history": "既往体健",
    "medication_history": "无",
    "allergy_history": "无",
    "family_history": "无",
    "social_history": "吸烟30年",
    "communication_style": "友善",
    "personality": {"health_literacy": "low", "verbosity": "normal", "anxiety_trait": "normal", "patience": "normal"},
}

VALID_DERIVATIVE = {
    "hidden_info": ["吸烟30年", "独居"],
    "required_inquiries": ["吸烟史", "发热程度"],
    "deep_background": {"吸烟史": "吸烟30年每日1包"},
    "exam_anchors": {"vital_signs": {"temperature": "38.5-39.2"}, "skin": "皮肤温暖"},
    "example_dialogues": [{"question": "您哪里不舒服？", "answer": "一直咳嗽"}],
}


class FakeLLM(LLMClient):
    def __init__(self, responses: list[dict]):
        self._responses = list(responses)
        self.calls: list[list[dict]] = []

    async def call_json(self, messages, **kwargs):
        self.calls.append(messages)
        if not self._responses:
            raise AssertionError("unexpected extra LLM call")
        return self._responses.pop(0)


def _req(**overrides) -> CaseGenerateRequest:
    base: dict[str, Any] = {
        "mode": "quick",
        "description": "生成一个老年肺炎病例",
    }
    base.update(overrides)
    return CaseGenerateRequest(**base)


class TestStageValidation:
    def test_core_missing_field(self):
        err = _validate_core_stage({})
        assert err
        assert "name" in err

    def test_core_missing_patient_info(self):
        err = _validate_core_stage({"name": "x", "chief_complaint": "y", "present_illness": "z", "patient_info": {}})
        assert err
        assert "patient_info" in err

    def test_core_valid(self):
        assert _validate_core_stage(VALID_CORE) is None

    def test_derivative_list_bounds(self):
        bad = {
            "hidden_info": [],
            "required_inquiries": [],
            "example_dialogues": [],
            "deep_background": {},
            "exam_anchors": {},
        }
        assert _validate_derivative_stage(bad)
        assert _validate_derivative_stage(VALID_DERIVATIVE) is None

    def test_derivative_wrong_types(self):
        err = _validate_derivative_stage(
            {
                "hidden_info": ["a"],
                "required_inquiries": ["b"],
                "example_dialogues": [{"q": 1}],
                "deep_background": "x",
                "exam_anchors": [],
            }
        )
        assert err
        assert "deep_background" in err
