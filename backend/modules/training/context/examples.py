"""Few-shot 示例段 — 把 case 的 example_dialogues 变成 user/assistant 消息对。

理由：扮演是风格模仿问题，示范放在输出通道（assistant 轮）比声明通道
（system 散文「护士问：X / 你回答：Y」）更有效。示例对是会话静态内容，
不影响 prefix cache。
"""

from __future__ import annotations

from .budget import estimate_text_tokens

# 前置一行 system 标记：防止模型把示例里的 user 轮误认成学生本轮输入。
EXAMPLES_MARKER = "以下为护患示例对话（演示患者如何回应，仅供风格参考，不是本次对话内容）："
MAX_EXAMPLE_PAIRS = 3
# 示例段整体 token 预算：预算紧张时先裁示例（优先级最低）。
MAX_EXAMPLES_TOKENS = 400


def build_example_pairs(case_data: dict) -> list[dict]:
    """返回 few-shot 消息对列表（空列表 = 无示例段）。

    保留最靠前的对话（生成时最有代表性的在前），逐对计费，超预算即停。
    """
    examples = case_data.get("example_dialogues") or []
    if not isinstance(examples, list):
        return []

    pairs: list[dict] = []
    budget = MAX_EXAMPLES_TOKENS
    for ex in examples[:MAX_EXAMPLE_PAIRS]:
        if not isinstance(ex, dict):
            continue
        q = str(ex.get("question", "") or "").strip()
        a = str(ex.get("answer", "") or "").strip()
        if not q or not a:
            continue
        cost = estimate_text_tokens(q) + estimate_text_tokens(a)
        if cost > budget and pairs:
            break
        pairs.append({"role": "user", "content": q})
        pairs.append({"role": "assistant", "content": a})
        budget -= cost
    return pairs
