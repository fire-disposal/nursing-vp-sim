"""assemble_patient_messages — 四域患者消息组装（纯函数）。

布局（固定形状，域序不可调换）：
  messages[0]      system  人设卡 (STATIC)        — 会话不变
  messages[1]      system  病例   (SESSION)       — 会话不变，逐字节稳定
  [可选] system   示例标记 + user/assistant 示例对  — EXAMPLES，会话不变
  [可选] user/assistant 历史                        — HISTORY，预算选择
  [可选] system   患者当前状态                      — PER-TURN，每轮变化
  messages[-1]     user    学生本轮输入

不变量：
  1. 纯函数：(case 渲染产物, session 状态, turn) → (messages, ledger)
  2. 静态前缀（人设卡+病例+示例）跨轮不变 → prefix cache 命中
  3. 每轮状态只出现在一个 system 消息、一个位置
  4. 除 history 外全部有界；history 上界 = budget + 保护集
"""

from __future__ import annotations

from .budget import (
    HISTORY_BUDGET_TOKENS,
    MIN_HISTORY_ROUNDS,
    estimate_text_tokens,
    select_history_messages,
)
from .examples import EXAMPLES_MARKER


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
) -> tuple[list[dict], dict]:
    """组装患者 LLM messages 数组。

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

    selected_history, dropped = select_history_messages(
        history,
        budget_tokens=history_budget_tokens,
        min_rounds=min_history_rounds,
    )
    history_msgs: list[dict] = []
    for msg in selected_history:
        role = "user" if getattr(msg, "role", "") == "student" else "assistant"
        history_msgs.append({"role": role, "content": getattr(msg, "content", "")})
    messages.extend(history_msgs)

    state_text = patient_state if patient_state and patient_state.strip() else ""
    if state_text:
        messages.append({"role": "system", "content": state_text})

    messages.append({"role": "user", "content": student_input})

    ledger = {
        "static_tokens": estimate_text_tokens(system_prompt),
        "session_tokens": estimate_text_tokens(session_prompt),
        "examples_tokens": sum(estimate_text_tokens(m["content"]) for m in example_msgs),
        "examples_pairs": len(example_msgs) // 2,
        "history_budget_tokens": history_budget_tokens,
        "history_selected_tokens": sum(estimate_text_tokens(m["content"]) for m in history_msgs),
        "history_dropped": dropped,
        "state_tokens": estimate_text_tokens(state_text),
        "user_tokens": estimate_text_tokens(student_input),
    }
    return messages, ledger
