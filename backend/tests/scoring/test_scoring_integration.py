"""
评分流程端到端集成验证 —— 以 LLM 视角核验 prompt 正确性。

运行:  cd backend && uv run pytest tests/test_scoring_integration.py -v -s
"""

import json
import os
import textwrap

os.environ["DEEPSEEK_API_KEY"] = "sk-test-placeholder"

import pytest

from modules.training.scoring.prompt_builder import (
    build_scoring_criteria,
    build_scoring_json_schema,
    build_scoring_rubric,
)
from profiles.rubric_loader import load_rubric
from prompts import render_template

# ── 模拟场景数据 ──

_MOCK_CONVERSATION = textwrap.dedent("""\
护士：您好，我是今天的护理实习生小张，请问您怎么称呼？
患者：我叫王大爷，今年65了。
护士：王大爷您好，请问您今天哪里不舒服？
患者：我最近总是头晕、头痛，大概一周了。
护士：能具体说说头疼的位置和什么样的疼吗？
患者：主要是后脑勺这一片，闷闷的疼，不是很剧烈但是持续不断。
护士：以前有过类似情况吗？
患者：以前偶尔有过，但没有这次持续这么久。
护士：您平时测过血压吗？
患者：社区医院测过，说有点高，但我也没太在意。
护士：您有高血压家族史吗？平时抽烟喝酒吗？
患者：我父亲有高血压，我吸烟30年了。
护士：好的王大爷，我已经了解了基本情况，感谢您的配合。
患者：谢谢你啊，小张护士。""")

_MOCK_REQUIRED_INQUIRIES = [
    "主诉（部位、性质、持续时间、诱因）",
    "现病史（起病情况、发展经过、诊疗经过）",
    "既往史",
    "过敏史",
    "用药史",
    "家族史",
]
_MOCK_REQUIRED_INQUIRIES_TEXT = json.dumps(_MOCK_REQUIRED_INQUIRIES, ensure_ascii=False, indent=2)


def _make_scoring_kwargs():
    rubric = load_rubric("nursing_history_v1")
    return {
        "scoring_criteria": build_scoring_criteria(rubric),
        "required_inquiries": _MOCK_REQUIRED_INQUIRIES_TEXT,
        "scoring_json_schema": build_scoring_json_schema(rubric),
    }


class TestScoringPromptSanity:
    """以 LLM 视角验证评分 prompt 结构是否正确"""

    def test_rubric_builds_without_error(self):
        rubric = load_rubric("nursing_history_v1")
        text = build_scoring_rubric(rubric, _MOCK_REQUIRED_INQUIRIES)
        assert len(text) > 1000
        assert "评分标准:" in text
        assert "沟通技能" in text
        assert "必须采集到的内容" in text

    def test_rubric_contains_required_sections(self):
        rubric = load_rubric("nursing_history_v1")
        text = build_scoring_rubric(rubric, _MOCK_REQUIRED_INQUIRIES)

        # 19 个条目全覆盖
        assert "学生与病人打招呼并问候" in text, "comm_01 缺失"
        assert "学生总结病史并确保病人没有遗漏重要信息" in text, "hist_05 缺失"
        assert text.count('"evidence"') == 19, "应有 19 个 evidence 占位"
        assert text.count('"reason"') == 19, "应有 19 个 reason 占位"

    def test_render_system_prompt_no_double_braces(self):
        """核心验证：渲染后的 prompt 不能包含 {{ 或 }}（双大括号会误导 LLM）"""
        from prompts.training.scoring import SCORING_SYSTEM

        system = render_template(SCORING_SYSTEM, **_make_scoring_kwargs())

        assert "{{" not in system, "发现双左大括号 - LLM 会被误导"
        assert "}}" not in system, "发现双右大括号 - LLM 会被误导"

    def test_render_user_prompt_no_double_braces(self):
        from prompts.training.scoring import SCORING_USER

        user = render_template(SCORING_USER, conversation_text=_MOCK_CONVERSATION)

        assert "{{" not in user, "发现双左大括号"
        assert "}}" not in user, "发现双右大括号"

    def test_conversation_braces_preserved_literally(self):
        """用户对话中的 { } 必须原样保留，不被替换"""
        conv = "护士：{请问这是什么情况？}"
        user = render_template("{#conversation_text#}", conversation_text=conv)
        assert conv in user, f"对话中的花括号被篡改: {user}"

    def test_json_template_is_valid_json_structure(self):
        """输出格式部分必须能被 json.loads 解析（去掉占位符后）"""
        rubric = load_rubric("nursing_history_v1")
        schema_text = build_scoring_json_schema(rubric)

        system = render_template("{#scoring_json_schema#}", scoring_json_schema=schema_text)

        start = system.find("{")
        end = system.rfind("}")
        if start != -1 and end != -1 and end > start:
            json_block = system[start : end + 1]
            # 新格式: "N(0~57)" 引号占位符 → 替换为数字
            json_block = json_block.replace('"N(0~57)"', "0")
            json_block = json_block.replace('"N(0~42)"', "0")
            json_block = json_block.replace('"N(0~15)"', "0")
            # item score: "1~3" → 1
            import re

            json_block = re.sub(r'"score":\s*"1~3"', '"score": 1', json_block)
            try:
                parsed = json.loads(json_block)
            except json.JSONDecodeError as e:
                pytest.fail(f"JSON 模板本身不是合法 JSON: {e}\n---\n{json_block[:200]}")
            assert "total_score" in parsed
            assert "detail_scores" in parsed
            assert parsed["total_score"] == 0  # placeholder replaced
            assert "沟通技能" in parsed["detail_scores"]
            assert "病史采集" in parsed["detail_scores"]

    def test_variable_name_match(self):
        """模板 {#var#} 与传入变量名一致"""
        rubric = load_rubric("nursing_history_v1")
        criteria_text = build_scoring_criteria(rubric)

        s, u = (
            render_template(
                "{#scoring_criteria#}\nEND",
                scoring_criteria=criteria_text,
            ),
            render_template(
                "{#conversation_text#}\nEND",
                conversation_text=_MOCK_CONVERSATION,
            ),
        )

        assert criteria_text in s
        assert _MOCK_CONVERSATION in u
        assert s.endswith("END")
        assert u.endswith("END")

    def test_full_system_prompt_structure(self):
        """模拟 LLM 收到的完整 system prompt 应包含所有关键段落"""
        from prompts.training.scoring import SCORING_SYSTEM

        system = render_template(SCORING_SYSTEM, **_make_scoring_kwargs())

        checks = [
            ("版本信息", "护理病史采集训练评分标准"),
            ("沟通技能维度", "沟通技能"),
            ("病史采集维度", "病史采集"),
            ("输出格式", "输出前自检"),
            ("JSON 模板", '"detail_scores"'),
            ("evidence 要求", "evidence"),
            ("reason 要求", "reason"),
            ("评分要求", "证据"),
            ("评分背景", "护理学生"),
        ]
        for label, keyword in checks:
            assert keyword in system, f"缺失: {label} ({keyword})"

        print("\n===== LLM 视角 System Prompt (前 500 字符) =====")
        print(system[:500])
        print("...")
        print(f"总长度: {len(system)} 字符")

    def testsafe_parse_json_with_valid_llm_response(self):
        """模拟 LLM 正确返回的 JSON 能否被解析"""
        from infrastructure.llm import safe_parse_json

        response = {
            "rubric_version": "nursing_history_v1@1.0",
            "total_score": 42,
            "detail_scores": {
                "沟通技能": {
                    "score": 32,
                    "max": 42,
                    "items": [
                        {
                            "id": "comm_01",
                            "name": "学生与病人打招呼并问候",
                            "score": 3,
                            "evidence": "学生主动礼貌问候并自我介绍",
                            "reason": "开场规范，自我介绍完整",
                        }
                    ],
                },
                "病史采集": {
                    "score": 10,
                    "max": 15,
                    "items": [
                        {
                            "id": "hist_01",
                            "name": "学生清晰地询问病人的过往病史",
                            "score": 2,
                            "evidence": "询问了既往史但不全面",
                            "reason": "问到了既往史但缺少深度",
                        }
                    ],
                },
            },
            "strengths": ["礼貌问候", "开场规范"],
            "weaknesses": ["既往史不够深入"],
            "missed_content": ["过敏史", "用药史"],
            "suggestions": "你在开场沟通方面表现良好，但病史采集深度不足。建议下次注意询问过敏史和用药史等关键信息。",
        }

        raw = json.dumps(response, ensure_ascii=False)
        parsed = safe_parse_json(raw)

        assert parsed["total_score"] == 42
        assert "detail_scores" in parsed
        assert "沟通技能" in parsed["detail_scores"]

    def test_coerce_string_numbers_to_int(self):
        """LLM 把数字写成字符串时自动转换为数字"""
        from modules.training.scoring.validation import _coerce_numeric_fields

        result = {
            "total_score": "24",
            "detail_scores": {
                "沟通技能": {
                    "score": "18",
                    "max": 42,
                    "items": [
                        {"id": "comm_01", "name": "打招呼", "score": "2", "evidence": "e", "reason": "r"},
                        {"id": "comm_02", "name": "问姓名", "score": "3", "evidence": "e", "reason": "r"},
                    ],
                },
                "病史采集": {
                    "score": "6",
                    "max": "15",
                    "items": [],
                },
            },
        }
        _coerce_numeric_fields(result)
        assert result["total_score"] == 24
        assert isinstance(result["total_score"], int)
        assert result["detail_scores"]["沟通技能"]["score"] == 18
        assert isinstance(result["detail_scores"]["沟通技能"]["score"], int)
        assert result["detail_scores"]["病史采集"]["max"] == 15
        assert isinstance(result["detail_scores"]["病史采集"]["max"], int)

    def test_coerce_float_score(self):
        from modules.training.scoring.validation import _coerce_numeric_fields

        result = {"total_score": "35.5"}
        _coerce_numeric_fields(result)
        assert result["total_score"] == 35.5

    def test_numeric_placeholders_not_quoted_in_json_template(self):
        """JSON 模板中的数字占位符不应有引号，避免 LLM 误解为字符串"""
        rubric = load_rubric("nursing_history_v1")
        text = build_scoring_rubric(rubric, _MOCK_REQUIRED_INQUIRIES)

        assert '"N_TOTAL_SCORE"' not in text, "sentinel 残留"
        assert '"N_DIM_SCORE"' not in text, "sentinel 残留"
        assert '"N_ITEM_SCORE"' not in text, "sentinel 残留"

        assert '"total_score": N' in text or '"total_score":' in text, "total_score 格式应为占位符"
        assert '"score": "1~3"' in text or '"score":' in text, "item score 格式"
        assert '"total_score": "数字"' not in text, "total_score 不应被引号包裹"
        assert '"N_TOTAL_SCORE"' not in text, "sentinel 残留"

    def test_render_template_missing_var_safety(self):
        """缺失变量的错误信息必须包含变量名，便于调试"""
        with pytest.raises(RuntimeError, match="missing_var"):
            render_template("{#missing_var#}", other="value")


class TestScoringFlowEndToEnd:
    """模拟完整评分数据流"""

    def test_full_prompt_rendering(self):
        from prompts.training.scoring import (
            SCORING_SYSTEM,
            SCORING_USER,
        )

        system = render_template(SCORING_SYSTEM, **_make_scoring_kwargs())
        user = render_template(SCORING_USER, conversation_text=_MOCK_CONVERSATION)

        assert len(system) > 500, "System prompt 过短"
        assert len(user) > 50, "User prompt 过短"

        # LLM 消息格式
        llm_messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        assert len(llm_messages) == 2
        assert all(m["content"] for m in llm_messages)

        # 打印供人工审查
        print("\n" + "=" * 60)
        print("LLM 收到的完整消息:")
        print("=" * 60)
        print(f"\n[SYSTEM] ({len(system)} chars)")
        print(system[:800])
        if len(system) > 800:
            print(f"\n... 省略 {len(system) - 800} 字符 ...")
        print(f"\n[USER] ({len(user)} chars)")
        print(user)
        print("=" * 60)

    def test_validate_scoring_result_safety(self):
        """评分验证不应对正确结果误报"""
        from modules.training.scoring.validation import _validate_scoring_result

        result = {
            "total_score": 42,
            "detail_scores": {
                "沟通技能": {
                    "score": 32,
                    "max": 42,
                    "items": [
                        {
                            "id": "comm_01",
                            "name": "打招呼",
                            "score": 3,
                            "evidence": "学生在对话开始时主动向病人问好",
                            "reason": "体现了良好的职业礼仪",
                        }
                    ],
                },
                "病史采集": {
                    "score": 10,
                    "max": 15,
                    "items": [
                        {
                            "id": "hist_01",
                            "name": "既往史",
                            "score": 2,
                            "evidence": "学生询问了病人是否有住院和手术经历",
                            "reason": "基本完整覆盖",
                        },
                        {
                            "id": "hist_02",
                            "name": "家族史",
                            "score": 0,
                            "evidence": "无",
                            "reason": "",
                        },
                    ],
                },
            },
            "strengths": ["礼貌问候"],
            "weaknesses": ["既往史不够深入"],
            "missed_content": ["过敏史"],
            "suggestions": "建议加强病史采集深度",
        }
        _validate_scoring_result(result)  # 不应抛异常：scored项有足够evidence，score=0项不校验

    def test_validate_rejects_missing_total_score(self):
        from modules.training.scoring.validation import _validate_scoring_result

        with pytest.raises(ValueError, match="缺失字段"):
            _validate_scoring_result({})

    def test_sample_vars_are_renderable(self):
        """SAMPLE_VARS 中的 scoring 预览数据必须可渲染"""
        rubric = load_rubric("nursing_history_v1")
        sample = {
            "scoring_criteria": build_scoring_criteria(rubric),
            "required_inquiries": json.dumps(
                ["主诉（部位、性质、持续时间、诱因）", "现病史（起病情况、发展经过、诊疗经过）"],
                ensure_ascii=False,
                indent=2,
            ),
            "scoring_json_schema": build_scoring_json_schema(rubric),
            "conversation_text": _MOCK_CONVERSATION,
        }
        assert sample, "scoring sample vars 为空"

        from prompts.training.scoring import SCORING_SYSTEM

        rendered = render_template(SCORING_SYSTEM, **sample)
        assert len(rendered) > 1000
        assert "{{" not in rendered
        assert "}}" not in rendered
