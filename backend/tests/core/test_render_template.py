"""Test the new render_template function and {#var#} syntax."""

import os

os.environ["DEEPSEEK_API_KEY"] = "sk-test-placeholder"

import pytest

from core.template import render_template, validate_template_vars


class TestRenderTemplate:
    def test_basic_substitution(self):
        r = render_template("Hello {#name#}!", name="World")
        assert r == "Hello World!"

    def test_json_in_value(self):
        r = render_template("JSON: {#data#}", data='{"key": "value"}')
        assert r == 'JSON: {"key": "value"}'

    def test_braces_in_value(self):
        r = render_template("Text: {#text#}", text="Some {braces} and {{more}}")
        assert r == "Text: Some {braces} and {{more}}"

    def test_chinese_variable_name(self):
        r = render_template("{#中文变量#}", 中文变量="成功")
        assert r == "成功"

    def test_plain_braces_untouched(self):
        r = render_template("{not_a_var} plain text", name="test")
        assert r == "{not_a_var} plain text"

    def test_json_braces_untouched(self):
        r = render_template('{"hello": "world"} {#name#}', name="test")
        assert r == '{"hello": "world"} test'

    def test_missing_variable_raises(self):
        with pytest.raises(RuntimeError):
            render_template("{#missing#}", present="yes")

    def test_db_template_compatible(self):
        template = "系统：{#scoring_rubric#}\n用户：{#conversation_text#}"
        r = render_template(
            template,
            scoring_rubric='{"score": 100}',
            conversation_text="护士：你好\n患者：不舒服",
        )
        assert '{"score": 100}' in r
        assert "护士：你好" in r

    def test_chat_template_compatible(self):
        template = "{#patient_info#}\n{#chief_complaint#}\n{#present_illness#}"
        r = render_template(
            template,
            patient_info="张三，45岁，男",
            chief_complaint="头痛3天",
            present_illness="3天前无明显诱因出现头痛",
        )
        assert "张三，45岁，男" in r
        assert "头痛3天" in r


class TestValidateTemplateVars:
    def test_all_vars_recognised(self):
        tmpl = "{#a#} {#b#}"
        assert validate_template_vars(tmpl, frozenset(["a", "b"])) == []

    def test_unknown_var_detected(self):
        tmpl = "{#a#} {#c#}"
        assert validate_template_vars(tmpl, frozenset(["a", "b"])) == ["c"]

    def test_empty_template(self):
        assert validate_template_vars("no vars here", frozenset(["a"])) == []

    def test_subset_allowed(self):
        tmpl = "{#a#}"
        assert validate_template_vars(tmpl, frozenset(["a", "b", "c"])) == []


class TestPromptVariableContracts:
    """Verify that every prompt template's variables match its TypedDict."""

    def test_scoring_system_vars(self):
        from modules.training.prompts.scoring import SCORING_SYSTEM
        from core.template_variables import ScoringSystemVars

        allowed = frozenset(ScoringSystemVars.__annotations__.keys())
        unknown = validate_template_vars(SCORING_SYSTEM, allowed)
        assert unknown == [], f"Unknown vars in SCORING_SYSTEM: {unknown}"

    def test_scoring_user_vars(self):
        from modules.training.prompts.scoring import SCORING_USER
        from core.template_variables import ScoringUserVars

        allowed = frozenset(ScoringUserVars.__annotations__.keys())
        unknown = validate_template_vars(SCORING_USER, allowed)
        assert unknown == [], f"Unknown vars in SCORING_USER: {unknown}"

    def test_emotion_analysis_user_vars(self):
        from modules.training.prompts.emotion import EMOTION_ANALYSIS_USER
        from core.template_variables import EmotionAnalysisUserVars

        allowed = frozenset(EmotionAnalysisUserVars.__annotations__.keys())
        unknown = validate_template_vars(EMOTION_ANALYSIS_USER, allowed)
        assert unknown == [], f"Unknown vars: {unknown}"

    def test_patient_system_vars(self):
        from modules.training.prompts.patient import PATIENT_SYSTEM
        from core.template_variables import PatientSystemVars

        allowed = frozenset(PatientSystemVars.__annotations__.keys())
        unknown = validate_template_vars(PATIENT_SYSTEM, allowed)
        assert unknown == [], f"Unknown vars in PATIENT_SYSTEM: {unknown}"

    def test_patient_dynamic_vars(self):
        from modules.training.prompts.patient import PATIENT_DYNAMIC
        from core.template_variables import PatientDynamicVars

        allowed = frozenset(PatientDynamicVars.__annotations__.keys())
        unknown = validate_template_vars(PATIENT_DYNAMIC, allowed)
        assert unknown == [], f"Unknown vars in PATIENT_DYNAMIC: {unknown}"

    def test_qa_system_vars(self):
        from modules.qa.prompts import QA_SYSTEM
        from core.template_variables import QASystemVars

        allowed = frozenset(QASystemVars.__annotations__.keys())
        unknown = validate_template_vars(QA_SYSTEM, allowed)
        assert unknown == [], f"Unknown vars in QA_SYSTEM: {unknown}"

    def test_generation_head_vars(self):
        from modules.cases.prompts import CASE_GENERATION_HEAD
        from core.template_variables import CaseGenerationSystemVars

        allowed = frozenset(CaseGenerationSystemVars.__annotations__.keys())
        unknown = validate_template_vars(CASE_GENERATION_HEAD, allowed)
        assert unknown == [], f"Unknown vars in CASE_GENERATION_HEAD: {unknown}"
