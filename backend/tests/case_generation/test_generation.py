"""生成服务测试：两阶段、修复循环、字段模式、校验。"""

from types import SimpleNamespace

import pytest

from core.exceptions import ValidationError
from modules.cases.generation import (
    _generate_stage,
    _validate_core_stage,
    _validate_derivative_stage,
    generate_case,
)
from schemas import CaseGenerateRequest

USER = SimpleNamespace(id=1)

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


class FakeLLM:
    def __init__(self, responses: list[dict]):
        self._responses = list(responses)
        self.calls: list[list[dict]] = []

    async def call_json(self, messages, **kwargs):
        self.calls.append(messages)
        if not self._responses:
            raise AssertionError("unexpected extra LLM call")
        return self._responses.pop(0)


def _req(**overrides) -> CaseGenerateRequest:
    base = {
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
        bad = {"hidden_info": [], "required_inquiries": [], "example_dialogues": [], "deep_background": {}, "exam_anchors": {}}
        assert _validate_derivative_stage(bad)
        assert _validate_derivative_stage(VALID_DERIVATIVE) is None

    def test_derivative_wrong_types(self):
        err = _validate_derivative_stage({"hidden_info": ["a"], "required_inquiries": ["b"], "example_dialogues": [{"q": 1}], "deep_background": "x", "exam_anchors": []})
        assert err
        assert "deep_background" in err


class TestGenerateCase:
    @pytest.mark.asyncio
    async def test_core_stage_only(self, db_session):
        llm = FakeLLM([VALID_CORE])
        resp = await generate_case(_req(stage="core"), db_session, USER, llm)
        assert resp.case_data["name"] == "肺炎患者的护理"
        assert "hidden_info" not in resp.case_data

    @pytest.mark.asyncio
    async def test_derivative_stage_merges_base(self, db_session):
        llm = FakeLLM([VALID_DERIVATIVE])
        resp = await generate_case(_req(stage="derivative", current_case_data=VALID_CORE), db_session, USER, llm)
        assert resp.case_data["name"] == "肺炎患者的护理"  # base preserved
        assert resp.case_data["required_inquiries"] == ["吸烟史", "发热程度"]

    @pytest.mark.asyncio
    async def test_derivative_requires_base(self, db_session):
        with pytest.raises(ValidationError):
            await generate_case(_req(stage="derivative"), db_session, USER, FakeLLM([]))

    @pytest.mark.asyncio
    async def test_full_chains_core_then_derivative(self, db_session):
        llm = FakeLLM([VALID_CORE, VALID_DERIVATIVE])
        resp = await generate_case(_req(), db_session, USER, llm)
        assert resp.case_data["name"] == "肺炎患者的护理"
        assert resp.case_data["required_inquiries"] == ["吸烟史", "发热程度"]
        assert len(llm.calls) == 2  # 两阶段各一次调用
        # derivative 调用必须携带骨架上下文
        assert "肺炎患者的护理" in llm.calls[1][0]["content"]

    @pytest.mark.asyncio
    async def test_repair_loop_retries_invalid_output(self, db_session):
        broken = dict(VALID_CORE)
        broken["patient_info"] = {}  # invalid: missing name/age/gender
        llm = FakeLLM([broken, VALID_CORE])
        resp = await generate_case(_req(stage="core"), db_session, USER, llm)
        assert resp.case_data["patient_info"]["name"] == "王大爷"
        assert len(llm.calls) == 2  # 初试 + 修复

    @pytest.mark.asyncio
    async def test_repair_exhausted_raises(self, db_session):
        broken = dict(VALID_CORE)
        broken["patient_info"] = {}
        with pytest.raises(ValidationError, match="AI 生成内容不符合要求"):
            await generate_case(_req(stage="core"), db_session, USER, FakeLLM([broken, broken]))

    @pytest.mark.asyncio
    async def test_field_generation_any_top_level(self, db_session):
        llm = FakeLLM([{"present_illness": "3天前受凉后咳嗽加重，夜间为甚"}])
        resp = await generate_case(_req(field="present_illness"), db_session, USER, llm)
        assert resp.field == "present_illness"
        assert "咳嗽" in resp.field_value

    @pytest.mark.asyncio
    async def test_empty_description_rejected(self, db_session):
        req = _req()
        req.description = "   "  # schema 层会拦截，这里直接改属性测内部守卫
        with pytest.raises(ValidationError):
            await generate_case(req, db_session, USER, FakeLLM([]))

    @pytest.mark.asyncio
    async def test_llm_error_propagates(self, db_session):
        class BoomLLM:
            async def call_json(self, messages, **kwargs):
                raise RuntimeError("provider down")

        from core.exceptions import LLMError

        with pytest.raises(LLMError):
            await generate_case(_req(stage="core"), db_session, USER, BoomLLM())


class TestStagePrompt:
    @pytest.mark.asyncio
    async def test_derivative_prompt_embeds_base_case(self, db_session):
        llm = FakeLLM([VALID_DERIVATIVE])
        await _generate_stage("derivative", _req(), "无", VALID_CORE, USER, llm)
        content = llm.calls[0][0]["content"]
        assert "教学衍生字段" in content
        assert "肺炎患者的护理" in content  # 骨架注入
        # 交叉一致性要求必须在 prompt 中
        assert "交叉一致性" in content

    @pytest.mark.asyncio
    async def test_core_prompt_no_derivative_fields(self, db_session):
        llm = FakeLLM([VALID_CORE])
        await _generate_stage("core", _req(), "无", None, USER, llm)
        content = llm.calls[0][0]["content"]
        assert "临床骨架" in content
        assert "exam_anchors" not in content
