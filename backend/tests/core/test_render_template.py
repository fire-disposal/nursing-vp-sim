"""Test the new render_template function and {#var#} syntax."""

import os

os.environ["DEEPSEEK_API_KEY"] = "sk-test-placeholder"

import pytest

from infrastructure.prompt import render_template


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

