"""Test the new render_template function and {#var#} syntax."""

import os

os.environ["SECRET_KEY"] = "test-secret-key-for-testing-only"
os.environ["DEEPSEEK_API_KEY"] = "sk-test-placeholder"

import pytest

from infrastructure.prompt import PromptTemplateObj, render_template


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


class TestPromptTemplateObj:
    def test_render_pair(self):
        pt = PromptTemplateObj(
            id=0,
            purpose="test",
            version=1,
            system_prompt="SYS: {#s#}",
            user_prompt="USR: {#u#}",
        )
        s, u = pt.render_pair(s="hello", u="world")
        assert s == "SYS: hello"
        assert u == "USR: world"

    def test_no_user_prompt(self):
        pt = PromptTemplateObj(
            id=0,
            purpose="test",
            version=1,
            system_prompt="{#x#}",
            user_prompt=None,
        )
        s, u = pt.render_pair(x="ok")
        assert s == "ok"
        assert u == ""

    def test_missing_var_in_pair_raises(self):
        pt = PromptTemplateObj(
            id=0,
            purpose="test",
            version=1,
            system_prompt="{#good#}",
            user_prompt="{#bad#}",
        )
        with pytest.raises(RuntimeError, match="bad"):
            pt.render_pair(good="ok")
