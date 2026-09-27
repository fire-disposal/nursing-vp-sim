"""HISTORY 中段压缩的回归测试（评审 R1）。

核心回归：预算饱和时**前缀逐字节不变**（而不是首部整体偏移），且旧轮次被压成摘要
而不是静默消失。是否饱和的可观测面是**消息结构**（摘要段是否存在、钉住的首轮是否
逐字保留）——装配流程不产出账本，内部 token 计数不是契约。
"""

from dataclasses import replace
from unittest.mock import MagicMock

from modules.training.context.budget import DEFAULT_POLICY, compact_history
from modules.training.context.compiler import compile_patient_prompt
from modules.training.context.history_compaction import (
    HISTORY_SUMMARY_HEADER,
    SUMMARY_SNIPPET_CHARS,
    group_rounds,
    summarize_rounds,
)

_BUDGET = 300
_POLICY = replace(DEFAULT_POLICY, history_budget_tokens=_BUDGET, min_history_rounds=2)


def _msg(role: str, content: str) -> MagicMock:
    m = MagicMock()
    m.role = role
    m.content = content
    return m


def _filler_history(rounds: int) -> list:
    """够长的历史：每条消息约 25 token，使 _BUDGET 必然饱和。"""
    out = []
    for i in range(rounds):
        out.append(_msg("student", f"问{i}:" + "主诉" * 20))
        out.append(_msg("patient", f"答{i}:" + "难受" * 20))
    return out


def _summary_index(messages: list[dict]) -> int | None:
    for index, message in enumerate(messages):
        if message["role"] == "system" and message["content"].startswith(HISTORY_SUMMARY_HEADER):
            return index
    return None


class TestSummarizeRounds:
    def test_empty_input(self):
        assert summarize_rounds([]) == ""

    def test_pairs_question_with_answer(self):
        text = summarize_rounds([_msg("student", "咳嗽几天了"), _msg("patient", "三天了")])
        assert text.startswith(HISTORY_SUMMARY_HEADER)
        assert "学生问：咳嗽几天了" in text
        assert "患者答：三天了" in text

    def test_orphan_messages_kept(self):
        assert "学生问：只有问句" in summarize_rounds([_msg("student", "只有问句")])
        assert "患者答：只有答句" in summarize_rounds([_msg("patient", "只有答句")])

    def test_deterministic(self):
        history = _filler_history(12)
        assert summarize_rounds(history) == summarize_rounds(history)

    def test_prefers_recent_rounds_and_counts_omitted(self):
        text = summarize_rounds(_filler_history(60))
        # 最近的旧轮次保留，更早的只计数——信息被压缩而非静默消失
        assert "答59:" in text
        assert "已省略" in text
        assert "问0:" not in text

    def test_grouping_is_two_messages_per_round(self):
        assert len(group_rounds(_filler_history(5))) == 5


class TestPrefixStabilityUnderSaturation:
    """R1 验收：预算饱和时稳定前缀逐字节不变。"""

    def _assemble(self, rounds: int) -> list[dict]:
        return compile_patient_prompt(
            role="STATIC",
            scenario="SESSION",
            history=_filler_history(rounds),
            student_input="last",
            policy=_POLICY,
        )

    def test_prefix_byte_identical_across_consecutive_turns(self):
        msgs_a = self._assemble(30)
        msgs_b = self._assemble(31)
        prefix_len = 2 + DEFAULT_POLICY.head_pinned_rounds * 2

        # 两轮都确实饱和（否则测不到裁剪）
        assert _summary_index(msgs_a) is not None
        assert _summary_index(msgs_b) is not None
        # 摘要紧跟钉住的首 K 轮：头部消息数就是 2*K，不多不少
        assert _summary_index(msgs_b) == prefix_len

        # 静态头两段 + 钉住的首 K 轮逐字节相同（旧实现此处会整体偏移）
        assert msgs_a[:prefix_len] == msgs_b[:prefix_len]
        assert msgs_a[2]["content"].startswith("问0:")
        assert msgs_b[2]["content"].startswith("问0:")

    def test_opening_round_survives_arbitrarily_long_session(self):
        msgs = self._assemble(200)
        assert msgs[2]["content"].startswith("问0:")
        assert msgs[3]["content"].startswith("答0:")
        assert _summary_index(msgs) is not None

    def test_summary_sits_between_pinned_head_and_recent_tail(self):
        msgs = self._assemble(30)
        idx = _summary_index(msgs)
        assert idx is not None
        assert idx == 2 + DEFAULT_POLICY.head_pinned_rounds * 2  # 紧跟钉住的首 K 轮
        # 摘要之后是连续的近期尾部，且尾部以最新一条历史收尾。
        # 尾部下界按**条**计费（见 compact_history），可能落在轮次中间，
        # 故不断言首条的角色，只断言：其后全为历史消息（无 system）、直至尾端。
        assert msgs[idx + 1]["content"].startswith(("问", "答"))
        assert all(m["role"] != "system" for m in msgs[idx + 1 :])
        assert msgs[-1]["content"] == "last"
        assert msgs[-2]["content"].startswith("答29:")

    def test_old_rounds_are_summarized_not_dropped(self):
        history = _filler_history(30)
        msgs = self._assemble(30)
        selection = compact_history(history, policy=_POLICY)
        assert selection.summarized

        # 最靠近尾部的被折叠轮次：逐字出现在摘要段，且**不**逐字出现在对话消息里
        marker = selection.summarized[-1].content[:SUMMARY_SNIPPET_CHARS]
        idx = _summary_index(msgs)
        assert idx is not None
        assert marker in msgs[idx]["content"]
        verbatim = [m["content"] for m in msgs if m["role"] != "system"]
        assert not any(marker in content for content in verbatim)

    def test_unsaturated_history_is_untouched(self):
        msgs = compile_patient_prompt(
            role="sys",
            scenario="dyn",
            history=_filler_history(2),
            student_input="last",
            policy=_POLICY,
        )
        assert _summary_index(msgs) is None
        assert len(msgs) == 2 + 4 + 1
