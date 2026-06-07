"""Tests for virtual_patient_prompt service"""

from unittest.mock import MagicMock

from services.patient_ai import (
    build_patient_chat_messages,
    build_patient_context_kwargs,
)


class TestBuildPatientContextKwargs:
    def test_returns_all_ten_keys(self):
        case = {"patient_info": {"name": "张三", "age": 45, "gender": "男"}}
        kwargs = build_patient_context_kwargs(case)
        assert set(kwargs.keys()) == {
            "communication_style", "patient_info", "chief_complaint",
            "present_illness", "allergy_history", "personality",
            "deep_background", "author_note", "scenario", "example_dialogues",
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
        assert len(kwargs["communication_style"]) > 0
        assert kwargs["allergy_history"] == "无已知过敏史"
        assert "正常配合" in kwargs["author_note"]

    def test_custom_values_override(self):
        case = {"chief_complaint": "咳嗽三天"}
        kwargs = build_patient_context_kwargs(case)
        assert kwargs["chief_complaint"] == "咳嗽三天"

    def test_personality_formatting(self):
        case = {
            "personality": {
                "health_literacy": "low",
                "verbosity": "verbose",
                "anxiety_trait": "anxious",
                "patience": "high",
            }
        }
        kwargs = build_patient_context_kwargs(case)
        assert "不太会描述病情" in kwargs["personality"]
        assert "容易焦虑" in kwargs["personality"]
        assert "非常耐心" in kwargs["personality"]

    def test_deep_background_formatting(self):
        case = {"deep_background": {"smoking": "30年吸烟史", "occupation": "建筑工人"}}
        kwargs = build_patient_context_kwargs(case)
        assert "30年吸烟史" in kwargs["deep_background"]
        assert "建筑工人" in kwargs["deep_background"]

    def test_deep_background_empty(self):
        case = {"deep_background": {}}
        kwargs = build_patient_context_kwargs(case)
        assert "无额外背景" in kwargs["deep_background"]


class TestBuildPatientChatMessages:
    def _make_msg(self, role, content):
        m = MagicMock()
        m.role = role
        m.content = content
        return m

    def test_system_prompt_is_first(self):
        history = [self._make_msg("student", "你好"), self._make_msg("patient", "你好")]
        msgs = build_patient_chat_messages("static", "dynamic", history, "test")
        assert msgs[0] == {"role": "system", "content": "static"}
        assert msgs[1] == {"role": "system", "content": "dynamic"}

    def test_author_note_injected_before_input(self):
        history = [self._make_msg("student", "你好"), self._make_msg("patient", "你好")]
        msgs = build_patient_chat_messages("static", "dynamic", history, "test question", author_note="【当前: 患者焦虑】")
        assert msgs[-2] == {"role": "system", "content": "【当前: 患者焦虑】"}
        assert msgs[-1] == {"role": "user", "content": "test question"}

    def test_no_author_note_when_empty(self):
        history = []
        msgs = build_patient_chat_messages("static", "dynamic", history, "test", author_note="")
        assert msgs[-1] == {"role": "user", "content": "test"}

    def test_student_message_is_last(self):
        history = [self._make_msg("student", "你好"), self._make_msg("patient", "你好")]
        msgs = build_patient_chat_messages("sys", "dyn", history, "当前问题")
        assert msgs[-1] == {"role": "user", "content": "当前问题"}

    def test_role_mapping(self):
        history = [
            self._make_msg("student", "问诊内容"),
            self._make_msg("patient", "患者回答"),
        ]
        msgs = build_patient_chat_messages("sys", "dyn", history, "追问")
        assert msgs[2] == {"role": "user", "content": "问诊内容"}
        assert msgs[3] == {"role": "assistant", "content": "患者回答"}

    def test_history_truncation(self):
        history = [self._make_msg("student", f"q{i}") for i in range(20)]
        msgs = build_patient_chat_messages("sys", "dyn", history, "last", max_rounds=3)
        assert len(msgs) == 8

    def test_empty_history(self):
        msgs = build_patient_chat_messages("sys", "dyn", [], "hello")
        assert len(msgs) == 3
        assert msgs[0]["role"] == "system"
        assert msgs[2] == {"role": "user", "content": "hello"}
