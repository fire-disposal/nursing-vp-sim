"""assemble_patient_messages — 四域患者消息组装（纯函数）。

布局（固定形状，域序不可调换）：
  messages[0]      system  人设卡 (STATIC)        — 会话不变
  messages[1]      system  病例   (SESSION)       — 会话不变，逐字节稳定
  [可选] system   示例标记 + user/assistant 示例对  — EXAMPLES，会话不变
  [可选] user/assistant 历史（钉住的首 K 轮）        — HISTORY-HEAD，跨轮逐字节稳定
  [可选] system   中段摘要                          — HISTORY-SUMMARY，半稳定
  [可选] user/assistant 历史（近期尾部）             — HISTORY-TAIL，预算选择
  [可选] system   患者当前状态                      — PER-TURN，每轮变化
  messages[-1]     user    学生本轮输入

不变量：
  1. 纯函数：(case 渲染产物, session 状态, turn) → (messages, ledger)
  2. 稳定前缀 = 人设卡 + 病例 + 示例 + 钉住的首 K 轮，跨轮逐字节不变 → prefix cache 命中
     （评审 R1：旧实现预算饱和后从最旧端整条丢弃，首部每轮偏移，缓存全失效）
  3. 每轮状态只出现在一个 system 消息、一个位置；中段摘要位于 HISTORY 段内部，
     与 PER-TURN 状态消息是两处不同的注入（位置不同、内容来源不同）
  4. 除 history 外全部有界；history 上界 = 首 K 轮 + min_rounds 保底 + 预算 + 摘要预算
"""

from __future__ import annotations

from .budget import (
    HEAD_PINNED_ROUNDS,
    HISTORY_BUDGET_TOKENS,
    MIN_HISTORY_ROUNDS,
    compact_history,
    estimate_text_tokens,
    resolve_token_scale,
)
from .examples import EXAMPLES_MARKER


def _as_llm_message(msg) -> dict:
    """历史消息 → LLM 消息（学生轮 → user，其余 → assistant）。"""
    role = "user" if getattr(msg, "role", "") == "student" else "assistant"
    return {"role": role, "content": getattr(msg, "content", "")}


def assemble_patient_messages(
    *,
    system_prompt: str,
    session_prompt: str,
    history: list,
    student_input: str,
    patient_state: str = "",
    examples: list[dict] | None = None,
    history_budget_tokens: int = HISTORY_BUDGET_TOKENS,
    min_history_rounds: int = MIN_HISTORY_ROUNDS,
    head_pinned_rounds: int = HEAD_PINNED_ROUNDS,
    estimated_prompt_tokens: int | None = None,
    actual_prompt_tokens: int | None = None,
) -> tuple[list[dict], dict]:
    """组装患者 LLM messages 数组。

    ``estimated_prompt_tokens`` / ``actual_prompt_tokens`` 是**上一轮** prompt 的
    估算与实际用量（后者来自 API usage）：两者都给出时按真实值收紧历史预算
    （评审 R4），缺省则回退纯估算。ledger 里的 ``prompt_estimated_tokens`` 就是
    本轮整份 prompt 的估算总量，下一轮回传即可闭环。

    返回 (messages, ledger)；ledger 为各段 token 账本，供可观测性使用。
    """
    messages: list[dict] = [
        {"role": "system", "content": system_prompt},
        {"role": "system", "content": session_prompt},
    ]

    example_msgs = list(examples or [])
    if example_msgs:
        messages.append({"role": "system", "content": EXAMPLES_MARKER})
        messages.extend(example_msgs)

    token_scale = resolve_token_scale(estimated=estimated_prompt_tokens, actual=actual_prompt_tokens)
    selection = compact_history(
        history,
        budget_tokens=history_budget_tokens,
        min_rounds=min_history_rounds,
        head_rounds=head_pinned_rounds,
        token_scale=token_scale,
    )

    head_msgs = [_as_llm_message(m) for m in selection.head]
    tail_msgs = [_as_llm_message(m) for m in selection.tail]
    messages.extend(head_msgs)
    if selection.summary:
        messages.append({"role": "system", "content": selection.summary})
    messages.extend(tail_msgs)

    state_text = patient_state if patient_state and patient_state.strip() else ""
    if state_text:
        messages.append({"role": "system", "content": state_text})

    messages.append({"role": "user", "content": student_input})

    history_tokens = sum(estimate_text_tokens(m["content"]) for m in [*head_msgs, *tail_msgs])
    ledger = {
        "static_tokens": estimate_text_tokens(system_prompt),
        "session_tokens": estimate_text_tokens(session_prompt),
        "examples_tokens": sum(estimate_text_tokens(m["content"]) for m in example_msgs),
        "examples_pairs": len(example_msgs) // 2,
        "history_budget_tokens": history_budget_tokens,
        "history_effective_budget_tokens": selection.effective_budget_tokens,
        "history_token_scale": token_scale,
        "history_head_messages": len(head_msgs),
        "history_selected_tokens": history_tokens,
        "history_summarized": len(selection.summarized),
        "history_summary_tokens": estimate_text_tokens(selection.summary),
        "state_tokens": estimate_text_tokens(state_text),
        "user_tokens": estimate_text_tokens(student_input),
    }
    # 本轮整份 prompt 的估算总量：下一轮把它当 ``estimated_prompt_tokens`` 传回，
    # 与 API usage 的真实值对账（infra.llm.token_counter.reconcile_tokens）即闭环
    ledger["prompt_estimated_tokens"] = sum(
        ledger[key]
        for key in (
            "static_tokens",
            "session_tokens",
            "examples_tokens",
            "history_selected_tokens",
            "history_summary_tokens",
            "state_tokens",
            "user_tokens",
        )
    )
    return messages, ledger
