"""Tests for virtual_patient_prompt service"""
from unittest.mock import MagicMock

from services.virtual_patient_prompt import (
    build_patient_chat_messages,
    build_patient_context_kwargs,
)


class TestBuildPatientContextKwargs:
    def test_returns_all_six_keys(self):
        case = {"patient_info": {"name": "张三", "age": 45, "gender": "男"}}
        kwargs = build_patient_context_kwargs(case)
        assert set(kwargs.keys()) == {
            "communication_style", "patient_info", "chief_complaint",
            "present_illness", "allergy_history", "hidden_info_rules",
        }

    def test_patient_info_formatting(self):
        case = {"patient_info": {"name": "张三", "age": 45, "gender": "男"}}
        kwargs = build_patient_context_kwargs(case)
        assert kwargs["patient_info"] == "张三，45岁，男"

    def test_patient_info_partial(self):
        case = {"patient_info": {"name": "李四"}}
        kwargs = build_patient_context_kwargs(case)
        assert kwargs["patient_info"] == "李四，岁，"

    def test_defaults_for_missing_fields(self):
        kwargs = build_patient_context_kwargs({})
        assert kwargs["communication_style"] == "友善自然"
        assert kwargs["chief_complaint"] == "未知"
        assert kwargs["present_illness"] == "未知"
        assert kwargs["allergy_history"] == "无"
        assert kwargs["hidden_info_rules"] == "暂无额外信息"

    def test_custom_values_override(self):
        case = {"chief_complaint": "咳嗽三天"}
        kwargs = build_patient_context_kwargs(case)
        assert kwargs["chief_complaint"] == "咳嗽三天"

    def test_hidden_info_empty_list(self):
        kwargs = build_patient_context_kwargs({}, [])
        assert kwargs["hidden_info_rules"] == "暂无额外信息"

    def test_hidden_info_triggered_items(self):
        allowed = [
            {"topic": "咯血", "content": "最近一周痰中带血丝", "triggered": True},
            {"topic": "用药", "content": "未按时服药", "triggered": False},
        ]
        kwargs = build_patient_context_kwargs({}, allowed)
        rules = kwargs["hidden_info_rules"]
        assert "痰中带血丝" in rules
        assert "未按时服药" not in rules

    def test_hidden_info_none(self):
        kwargs = build_patient_context_kwargs({}, None)
        assert kwargs["hidden_info_rules"] == "暂无额外信息"


class TestBuildPatientChatMessages:
    def _make_msg(self, role, content):
        m = MagicMock()
        m.role = role
        m.content = content
        return m

    def test_system_prompt_is_first(self):
        history = [self._make_msg("student", "你好"), self._make_msg("patient", "你好")]
        msgs = build_patient_chat_messages("system-abc", history, "test")
        assert msgs[0] == {"role": "system", "content": "system-abc"}

    def test_student_message_is_last(self):
        history = [self._make_msg("student", "你好"), self._make_msg("patient", "你好")]
        msgs = build_patient_chat_messages("sys", history, "当前问题")
        assert msgs[-1] == {"role": "user", "content": "当前问题"}

    def test_role_mapping(self):
        history = [
            self._make_msg("student", "问诊内容"),
            self._make_msg("patient", "患者回答"),
        ]
        msgs = build_patient_chat_messages("sys", history, "追问")
        assert msgs[1] == {"role": "user", "content": "问诊内容"}
        assert msgs[2] == {"role": "assistant", "content": "患者回答"}

    def test_history_truncation(self):
        history = [self._make_msg("student", f"q{i}") for i in range(20)]
        msgs = build_patient_chat_messages("sys", history, "last", max_rounds=3)
        # system(1) + 3 rounds(6) + student(1) = 8
        assert len(msgs) == 8

    def test_empty_history(self):
        msgs = build_patient_chat_messages("sys", [], "hello")
        assert len(msgs) == 2
        assert msgs[0]["role"] == "system"
        assert msgs[1] == {"role": "user", "content": "hello"}
