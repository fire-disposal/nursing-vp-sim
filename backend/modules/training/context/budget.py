"""History token budget — 按 token 预算选择历史，带保护集（最近 N 轮保底）。

估算使用 ``infra.llm.token_counter.estimate_tokens``（DeepSeek 官方 0.6/0.3 比例，
与计费口径一致）。预算大方时（默认 2000 tokens）多数训练会话不会触发裁剪。
"""

from __future__ import annotations

from infra.llm.token_counter import estimate_tokens

# 历史区 token 预算：固定开销（静态/会话/状态/示例）之外的余量全给历史。
HISTORY_BUDGET_TOKENS = 2000
# 保护集：最近 N 轮（N*2 条消息）无条件保留，防止预算吃光关键近期上下文。
MIN_HISTORY_ROUNDS = 4


def estimate_text_tokens(text: str) -> int:
    """单文本 token 估算（0 长度返回 0）。"""
    return estimate_tokens(text)


def select_history_messages(
    messages: list,
    *,
    budget_tokens: int = HISTORY_BUDGET_TOKENS,
    min_rounds: int = MIN_HISTORY_ROUNDS,
) -> tuple[list, int]:
    """从新到旧选择历史消息。

    - system 消息跳过（不进入 LLM 历史）
    - 最近 ``min_rounds`` 轮（2*min_rounds 条）无条件保留
    - 更早的消息逐条按 token 预算纳入；一旦某条超出预算则更早的全部丢弃
      （新到旧单调，首个超预算点即裁剪边界）

    返回 (selected, dropped_count)，selected 保持时间顺序。
    """
    non_system = [m for m in messages if getattr(m, "role", "") != "system"]
    floor = min(len(non_system), min_rounds * 2)

    selected: list = []
    budget = budget_tokens
    for i in range(len(non_system) - 1, -1, -1):
        msg = non_system[i]
        is_floor = len(non_system) - i <= floor
        cost = estimate_text_tokens(str(getattr(msg, "content", "")))
        if is_floor or cost <= budget:
            selected.append(msg)
            if not is_floor:
                budget -= cost
        else:
            break

    selected.reverse()
    dropped = len(non_system) - len(selected)
    return selected, dropped
