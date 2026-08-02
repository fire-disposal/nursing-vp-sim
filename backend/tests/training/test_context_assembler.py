"""Tests for the four-domain patient context assembler (context package)."""

from unittest.mock import MagicMock

from core.template import render_template
from modules.training.context.assembler import assemble_patient_messages
from modules.training.context.budget import select_history_messages
from modules.training.context.examples import EXAMPLES_MARKER, build_example_pairs
from modules.training.context.leak_guard import (
    find_hidden_topic_leaks,
    get_hidden_topic_correction_note,
)
from modules.training.context.patient_state import PATIENT_STATE_HEADER, build_patient_state
from modules.training.pipeline.prompt_context_builder import build_context_kwargs
from modules.training.prompts.patient import PATIENT_DYNAMIC, PATIENT_SYSTEM


def _msg(role: str, content: str) -> MagicMock:
    m = MagicMock()
    m.role = role
    m.content = content
    return m


def _history(n: int, prefix: str = "q") -> list:
    out = []
    for i in range(n):
        out.append(_msg("student", f"{prefix}{i}问"))
        out.append(_msg("patient", f"{prefix}{i}答"))
    return out


class TestAssemblePatientMessages:
    def test_domain_order(self):
        msgs, _ = assemble_patient_messages(
            system_prompt="static",
            session_prompt="session",
            history=_history(1),
            student_input="你好",
        )
        assert msgs[0] == {"role": "system", "content": "static"}
        assert msgs[1] == {"role": "system", "content": "session"}
        assert msgs[-1] == {"role": "user", "content": "你好"}

    def test_layout_with_examples_and_state(self):
        msgs, _ = assemble_patient_messages(
            system_prompt="static",
            session_prompt="session",
            history=_history(1),
            student_input="追问",
            patient_state="【状态】患者焦虑",
            examples=[
                {"role": "user", "content": "示例问"},
                {"role": "assistant", "content": "示例答"},
            ],
        )
        assert msgs[2] == {"role": "system", "content": EXAMPLES_MARKER}
        assert msgs[3] == {"role": "user", "content": "示例问"}
        assert msgs[4] == {"role": "assistant", "content": "示例答"}
        # history 紧随示例段
        assert msgs[5] == {"role": "user", "content": "q0问"}
        assert msgs[6] == {"role": "assistant", "content": "q0答"}
        # 每轮状态在 user 输入之前
        assert msgs[-2] == {"role": "system", "content": "【状态】患者焦虑"}
        assert msgs[-1] == {"role": "user", "content": "追问"}

    def test_no_state_no_examples_user_is_last(self):
        msgs, _ = assemble_patient_messages(
            system_prompt="sys",
            session_prompt="dyn",
            history=_history(1),
            student_input="test",
            patient_state="",
            examples=None,
        )
        assert msgs[-1] == {"role": "user", "content": "test"}
        assert all(m["role"] != "system" or m["content"] not in ("", " ") for m in msgs[2:-1])

    def test_role_mapping(self):
        msgs, _ = assemble_patient_messages(
            system_prompt="sys",
            session_prompt="dyn",
            history=[_msg("student", "问诊内容"), _msg("patient", "患者回答")],
            student_input="追问",
        )
        assert msgs[2] == {"role": "user", "content": "问诊内容"}
        assert msgs[3] == {"role": "assistant", "content": "患者回答"}

    def test_system_history_messages_skipped(self):
        msgs, _ = assemble_patient_messages(
            system_prompt="sys",
            session_prompt="dyn",
            history=[
                _msg("system", "ignored"),
                _msg("student", "a"),
                _msg("patient", "b"),
            ],
            student_input="c",
        )
        contents = [m["content"] for m in msgs]
        assert "ignored" not in contents

    def test_history_floor_keeps_recent_under_zero_budget(self):
        msgs, ledger = assemble_patient_messages(
            system_prompt="sys",
            session_prompt="dyn",
            history=_history(20),
            student_input="last",
            history_budget_tokens=0,
            min_history_rounds=2,
        )
        # floor = 2 轮 = 4 条消息；预算 0 → 更早的全裁
        assert len(msgs) == 2 + 4 + 1
        assert msgs[-2]["content"] == "q19答"
        assert ledger["history_dropped"] == 36

    def test_generous_budget_keeps_all(self):
        msgs, ledger = assemble_patient_messages(
            system_prompt="sys",
            session_prompt="dyn",
            history=_history(20),
            student_input="last",
            history_budget_tokens=100_000,
        )
        assert ledger["history_dropped"] == 0
        assert len(msgs) == 2 + 40 + 1

    def test_ledger_contains_segments(self):
        _, ledger = assemble_patient_messages(
            system_prompt="static",
            session_prompt="session",
            history=_history(3),
            student_input="你好",
            patient_state="状态",
            examples=[{"role": "user", "content": "q"}, {"role": "assistant", "content": "a"}],
        )
        for key in (
            "static_tokens",
            "session_tokens",
            "examples_tokens",
            "examples_pairs",
            "history_budget_tokens",
            "history_selected_tokens",
            "history_dropped",
            "state_tokens",
            "user_tokens",
        ):
            assert key in ledger
        assert ledger["examples_pairs"] == 1
        assert ledger["state_tokens"] > 0


class TestSelectHistoryMessages:
    def test_empty_history(self):
        selected, dropped = select_history_messages([])
        assert selected == []
        assert dropped == 0

    def test_floor_protection(self):
        history = _history(10)
        selected, dropped = select_history_messages(history, budget_tokens=0, min_rounds=2)
        assert dropped == 16
        assert [m.content for m in selected] == ["q8问", "q8答", "q9问", "q9答"]

    def test_budget_extends_floor(self):
        history = _history(10)
        selected, _ = select_history_messages(history, budget_tokens=10_000)
        assert len(selected) == 20

    def test_system_ignored(self):
        history = [_msg("system", "x")] + _history(2)
        selected, _ = select_history_messages(history)
        assert len(selected) == 4


class TestExamplePairs:
    def test_capped_at_max_pairs(self):
        case = {"example_dialogues": [{"question": f"q{i}", "answer": f"a{i}"} for i in range(5)]}
        pairs = build_example_pairs(case)
        assert len(pairs) == 6  # 3 对
        assert [p["role"] for p in pairs] == ["user", "assistant"] * 3

    def test_empty_when_missing(self):
        assert build_example_pairs({}) == []
        assert build_example_pairs({"example_dialogues": []}) == []

    def test_skips_incomplete_items(self):
        case = {
            "example_dialogues": [
                {"question": "q", "answer": "a"},
                {"question": "q2"},
                {"answer": "a3"},
                "not-a-dict",
            ]
        }
        pairs = build_example_pairs(case)
        assert len(pairs) == 2

    def test_token_budget_limits_pairs(self):
        case = {"example_dialogues": [{"question": "长" * 200, "answer": "长" * 200} for _ in range(3)]}
        pairs = build_example_pairs(case)
        assert len(pairs) <= 2  # 第一对超预算也保留，后续截断


class TestBuildPatientState:
    def test_combines_sections(self):
        text = build_patient_state(scene_text="场景", note_text="情绪")
        assert PATIENT_STATE_HEADER in text
        assert "场景" in text
        assert "情绪" in text

    def test_empty_returns_empty(self):
        assert build_patient_state() == ""
        assert build_patient_state(scene_text="  ") == ""

    def test_whitespace_only_notes_ignored(self):
        assert build_patient_state(note_text="\n\n", scene_text="场景") != ""


class TestLeakGuard:
    def test_detects_hidden_topic(self):
        case = {"deep_background": {"吸烟史": "吸烟30年", "职业": "退休工人"}}
        leaks = find_hidden_topic_leaks("我确实有几十年的吸烟史", case, "你现在感觉怎么样")
        assert leaks == ["吸烟史"]

    def test_asked_exemption(self):
        case = {"deep_background": {"吸烟史": "吸烟30年"}}
        leaks = find_hidden_topic_leaks("我吸烟大概30年了", case, "您有吸烟史吗")
        assert leaks == []

    def test_no_deep_background_no_leak(self):
        assert find_hidden_topic_leaks("我很难受", {}, "你好") == []

    def test_short_keys_ignored(self):
        case = {"deep_background": {"烟": "吸烟30年"}}
        assert find_hidden_topic_leaks("我抽烟", case, "你好") == []

    def test_empty_reply(self):
        assert find_hidden_topic_leaks("", {"deep_background": {"吸烟史": "x"}}, "你好") == []

    def test_correction_note_mentions_topics(self):
        note = get_hidden_topic_correction_note(["吸烟史", "职业"])
        assert "吸烟史" in note
        assert "职业" in note


class TestPromptRenderingSmoke:
    """模板与组装端到端：真实 case 渲染后无残留占位符，布局完整。"""

    _CASE = {
        "patient_info": {"name": "张三", "age": 45, "gender": "男"},
        "chief_complaint": "咳嗽三天",
        "present_illness": "三天前开始咳嗽",
        "past_history": "无",
        "medication_history": "无",
        "allergy_history": "无",
        "family_history": "无",
        "social_history": "无",
        "communication_style": "口语化",
        "personality": {"patience": "high", "mood": "irritable"},
        "deep_background": {"吸烟史": "吸烟30年，每日1包"},
        "example_dialogues": [
            {"question": "您哪里不舒服？", "answer": "就是一直咳嗽，咳得我胸口疼。"},
        ],
    }

    def test_templates_render_without_residue(self):
        kwargs = build_context_kwargs(self._CASE)
        assert "example_dialogues" not in kwargs
        assert "author_note" not in kwargs
        system = render_template(PATIENT_SYSTEM, **kwargs)
        dynamic = render_template(PATIENT_DYNAMIC, **kwargs)
        assert "{#" not in system
        assert "{#" not in dynamic
        assert "对话参考" not in dynamic
        assert "当前状态" not in dynamic

    def test_assembler_smoke_with_real_templates(self):
        kwargs = build_context_kwargs(self._CASE)
        system = render_template(PATIENT_SYSTEM, **kwargs)
        dynamic = render_template(PATIENT_DYNAMIC, **kwargs)
        msgs, ledger = assemble_patient_messages(
            system_prompt=system,
            session_prompt=dynamic,
            history=_history(2),
            student_input="您哪里不舒服？",
            patient_state=build_patient_state(note_text="【患者当前互动策略】配合"),
            examples=build_example_pairs(self._CASE),
        )
        assert msgs[0]["role"] == "system"
        assert "{#" not in msgs[0]["content"]
        assert msgs[1]["content"] == dynamic
        assert EXAMPLES_MARKER in msgs[2]["content"]
        assert msgs[-1]["role"] == "user"
        assert ledger["examples_pairs"] == 1
