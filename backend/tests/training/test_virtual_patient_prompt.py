"""Tests for virtual_patient_prompt service — case_data → template kwargs.

四域组装（static/session/examples/history/per-turn）的测试见
``test_context_assembler.py``；本文件专注 case 模板变量提取。
"""

from modules.training.pipeline.prompt_context_builder import build_context_kwargs


class TestBuildPatientContextKwargs:
    def test_returns_all_expected_keys(self):
        case = {"patient_info": {"name": "张三", "age": 45, "gender": "男"}}
        kwargs = build_context_kwargs(case)
        expected = {
            "patient_info",
            "scenario",
            "chief_complaint",
            "present_illness",
            "past_history",
            "medication_history",
            "allergy_history",
            "family_history",
            "social_history",
            "communication_style",
            "personality",
            "deep_background",
        }
        assert expected <= set(kwargs)
        # 四域重构后：示例对话与 author_note 不再进入模板变量
        # （分别由 few-shot 消息对与 per-turn 状态消息承载）
        assert "example_dialogues" not in kwargs
        assert "author_note" not in kwargs

    def test_patient_info_formatting(self):
        case = {"patient_info": {"name": "张三", "age": 45, "gender": "男"}}
        kwargs = build_context_kwargs(case)
        assert kwargs["patient_info"] == "张三，45岁，男"

    def test_patient_info_partial(self):
        case = {"patient_info": {"name": "李四"}}
        kwargs = build_context_kwargs(case)
        assert kwargs["patient_info"] == "李四"

    def test_defaults_for_missing_fields(self):
        kwargs = build_context_kwargs({})
        assert kwargs["patient_info"] == "患者"
        assert "无特殊既往史" in kwargs["past_history"]
        assert kwargs["communication_style"] == "用口语化、真实患者的口吻交流。"

    def test_custom_values_override(self):
        case = {"chief_complaint": "咳嗽三天"}
        kwargs = build_context_kwargs(case)
        assert kwargs["chief_complaint"] == "咳嗽三天"

    def test_personality_formatting(self):
        case = {"personality": {"patience": "high", "mood": "irritable"}}
        kwargs = build_context_kwargs(case)
        assert "反复讲" in kwargs["personality"]
        assert "烦躁易怒" in kwargs["personality"]

    def test_deep_background_formatting(self):
        case = {"deep_background": {"smoking": "30年吸烟史", "occupation": "建筑工人"}}
        kwargs = build_context_kwargs(case)
        assert "30年吸烟史" in kwargs["deep_background"]
        assert "建筑工人" in kwargs["deep_background"]

    def test_deep_background_empty(self):
        case = {"deep_background": {}}
        kwargs = build_context_kwargs(case)
        assert "无额外背景" in kwargs["deep_background"]
