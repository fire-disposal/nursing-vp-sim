"""HISTORY 中段压缩（评审 R1）与 token 口径对账（评审 R4）的回归测试。

R1 的核心回归：预算饱和时**前缀逐字节不变**（而不是首部整体偏移），且旧轮次被
压成摘要而不是静默消失。R4 的核心回归：真实用量高于估算时预算按真实值收紧，
缺省 usage 时回退估算。
"""

from unittest.mock import MagicMock

from infra.llm.token_counter import reconcile_tokens
from modules.training.context.assembler import assemble_patient_messages
from modules.training.context.budget import (
    HEAD_PINNED_ROUNDS,
    MAX_TOKEN_SCALE,
    compact_history,
    resolve_token_scale,
)
from modules.training.context.history_compaction import (
    HISTORY_SUMMARY_HEADER,
    SUMMARY_SNIPPET_CHARS,
    group_rounds,
    summarize_rounds,
)

_BUDGET = 300


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

    def _assemble(self, rounds: int):
        return assemble_patient_messages(
            system_prompt="STATIC",
            session_prompt="SESSION",
            history=_filler_history(rounds),
            student_input="last",
            history_budget_tokens=_BUDGET,
            min_history_rounds=2,
        )

    def test_prefix_byte_identical_across_consecutive_turns(self):
        msgs_a, ledger_a = self._assemble(30)
        msgs_b, ledger_b = self._assemble(31)
        prefix_len = 2 + HEAD_PINNED_ROUNDS * 2

        # 两轮都确实饱和（否则测不到裁剪）
        assert ledger_a["history_summarized"] > 0
        assert ledger_b["history_summarized"] > 0

        # 静态头两段 + 钉住的首 K 轮逐字节相同（旧实现此处会整体偏移）
        assert msgs_a[:prefix_len] == msgs_b[:prefix_len]
        assert msgs_a[2]["content"].startswith("问0:")
        assert msgs_b[2]["content"].startswith("问0:")
        assert ledger_b["history_head_messages"] == HEAD_PINNED_ROUNDS * 2

    def test_opening_round_survives_arbitrarily_long_session(self):
        msgs, ledger = self._assemble(200)
        assert msgs[2]["content"].startswith("问0:")
        assert msgs[3]["content"].startswith("答0:")
        assert ledger["history_summarized"] > 0

    def test_summary_sits_between_pinned_head_and_recent_tail(self):
        msgs, _ = self._assemble(30)
        heads = [
            i for i, m in enumerate(msgs) if m["role"] == "system" and m["content"].startswith(HISTORY_SUMMARY_HEADER)
        ]
        assert len(heads) == 1
        idx = heads[0]
        assert idx == 2 + HEAD_PINNED_ROUNDS * 2  # 紧跟钉住的首 K 轮
        # 摘要之后是连续的近期尾部，且尾部以最新一条历史收尾。
        # 尾部下界按**条**计费（见 compact_history），可能落在轮次中间，
        # 故不断言首条的角色，只断言：其后全为历史消息（无 system）、直至尾端。
        assert msgs[idx + 1]["content"].startswith(("问", "答"))
        assert all(m["role"] != "system" for m in msgs[idx + 1 :])
        assert msgs[-1]["content"] == "last"
        assert msgs[-2]["content"].startswith("答29:")

    def test_old_rounds_are_summarized_not_dropped(self):
        history = _filler_history(30)
        msgs, ledger = self._assemble(30)
        selection = compact_history(history, budget_tokens=_BUDGET, min_rounds=2, head_rounds=HEAD_PINNED_ROUNDS)
        assert selection.summarized
        assert ledger["history_summarized"] == len(selection.summarized)

        # 最靠近尾部的被折叠轮次：逐字出现在摘要段，且**不**逐字出现在对话消息里
        marker = selection.summarized[-1].content[:SUMMARY_SNIPPET_CHARS]
        summary_msg = next(m for m in msgs if m["role"] == "system" and m["content"].startswith(HISTORY_SUMMARY_HEADER))
        assert marker in summary_msg["content"]
        verbatim = [m["content"] for m in msgs if m["role"] != "system"]
        assert not any(marker in content for content in verbatim)

    def test_unsaturated_history_is_untouched(self):
        msgs, ledger = assemble_patient_messages(
            system_prompt="sys",
            session_prompt="dyn",
            history=_filler_history(2),
            student_input="last",
            history_budget_tokens=_BUDGET,
        )
        assert ledger["history_summarized"] == 0
        assert all(m["content"] != HISTORY_SUMMARY_HEADER for m in msgs)
        assert len(msgs) == 2 + 4 + 1


class TestTokenReconciliation:
    """R4 验收：对账入口与按真实用量的预算校正。"""

    def test_delta_and_ratio(self):
        recon = reconcile_tokens(1000, 3000)
        assert recon.estimated == 1000
        assert recon.actual == 3000
        assert recon.delta == 2000
        assert recon.ratio == 3.0

    def test_missing_actual_falls_back_to_estimate(self):
        recon = reconcile_tokens(1234, None)
        assert recon.actual == 1234
        assert recon.delta == 0
        assert recon.ratio == 1.0

    def test_zero_estimate_is_neutral(self):
        assert reconcile_tokens(0, 500).ratio == 1.0

    def test_scale_never_relaxes_below_one(self):
        assert resolve_token_scale(estimated=1000, actual=200) == 1.0
        assert resolve_token_scale(estimated=1000, actual=1500) == 1.5

    def test_scale_capped(self):
        assert resolve_token_scale(estimated=1000, actual=999_999) == MAX_TOKEN_SCALE

    def test_scale_falls_back_without_usage(self):
        assert resolve_token_scale(estimated=None, actual=None) == 1.0
        assert resolve_token_scale(estimated=1000, actual=None) == 1.0

    def test_actual_usage_above_estimate_shrinks_history(self):
        history = _filler_history(30)
        common = {
            "system_prompt": "sys",
            "session_prompt": "dyn",
            "history": history,
            "student_input": "last",
            "history_budget_tokens": _BUDGET,
            "min_history_rounds": 2,
        }
        _, estimated_ledger = assemble_patient_messages(**common)
        _, actual_ledger = assemble_patient_messages(**common, estimated_prompt_tokens=1000, actual_prompt_tokens=3000)

        assert estimated_ledger["history_token_scale"] == 1.0
        assert actual_ledger["history_token_scale"] == 3.0
        assert actual_ledger["history_effective_budget_tokens"] == _BUDGET // 3
        # 按真实值收紧后，逐字保留的历史更少、被摘要的更多
        assert actual_ledger["history_selected_tokens"] < estimated_ledger["history_selected_tokens"]
        assert actual_ledger["history_summarized"] > estimated_ledger["history_summarized"]

    def test_ledger_estimate_closes_reconciliation_loop(self):
        """ledger 自报的估算总量可直接作为下一轮的对账输入（生产接线方式）。"""
        common = {
            "system_prompt": "sys",
            "session_prompt": "dyn",
            "history": _filler_history(30),
            "student_input": "last",
            "history_budget_tokens": _BUDGET,
            "min_history_rounds": 2,
        }
        _, first = assemble_patient_messages(**common)
        _, second = assemble_patient_messages(
            **common,
            estimated_prompt_tokens=first["prompt_estimated_tokens"],
            actual_prompt_tokens=first["prompt_estimated_tokens"] * 2,
        )
        assert second["history_token_scale"] == 2.0
        assert second["history_effective_budget_tokens"] == _BUDGET // 2
