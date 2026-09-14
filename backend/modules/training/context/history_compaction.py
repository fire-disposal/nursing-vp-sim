"""HISTORY 中段压缩 —— 被折叠旧轮次的摘要文本（纯函数，无外部依赖）。

背景（评审 R1）：预算饱和后从**最旧端**整条丢弃的裁剪方式有两个后果：
  1. 每轮数组首部整体偏移 → DeepSeek 前缀缓存（命中价 ¥0.02/1M vs 未命中 ¥1/1M，
     约 1/50）在 HISTORY 段失效，长会话每轮按未命中价重算；
  2. 开场主诉（chief_complaint 相关的最初几轮）被最先丢掉 → 患者"忘记"自己为何就诊。

现在由 ``budget.compact_history`` 只从**中段**丢弃：钉住首 K 轮，把中段旧轮次交给本
模块压成摘要文本，再作为一条 system 消息插回「钉住的首 K 轮」与「近期尾部」之间。

摘要生成本身是确定性抽取式纯函数（不调用 LLM，无外部依赖）：每轮保留学生问句与
患者答句的骨架，按 token 预算从**最近的旧轮次**往前纳入，更早的以计数省略。
需要模型生成的高质量摘要时，把 ``budget.compact_history(summarizer=...)`` 换成实现
``Callable[[list], str]`` 的调用方函数即可 —— 接缝在此，本模块不引入任何 LLM 依赖，
也不缓存任何跨轮状态。
"""

from __future__ import annotations

from infra.llm.token_counter import estimate_tokens

# 摘要段 token 预算：被折叠的中段整体压到该上限内（必须远小于 HISTORY_BUDGET_TOKENS，
# 否则"摘要"反而不省 token）。
SUMMARY_BUDGET_TOKENS = 300
# 前置一行标记：让模型分清"这段是更早对话的压缩"与"真实历史消息"。
HISTORY_SUMMARY_HEADER = "【前情摘要】以下为更早对话的压缩内容，不是本轮对话内容，仅供延续语气与事实："
# 单轮问/答各自保留的字符数（抽取式骨架，不做语义改写）。
SUMMARY_SNIPPET_CHARS = 24


def _snippet(text: str, limit: int = SUMMARY_SNIPPET_CHARS) -> str:
    """压平空白并截断到 ``limit`` 字符（超出加省略号）。"""
    flat = " ".join(str(text or "").split())
    return flat if len(flat) <= limit else flat[:limit] + "…"


def _format_round(question: str, answer: str) -> str:
    """把一轮问答渲染成摘要里的一行（任一侧为空则只输出另一侧）。"""
    parts = []
    if question:
        parts.append(f"学生问：{_snippet(question)}")
    if answer:
        parts.append(f"患者答：{_snippet(answer)}")
    return "- " + "；".join(parts)


def group_rounds(messages: list) -> list[tuple[str, str]]:
    """把历史消息按「学生问 → 患者答」编组成轮次，容忍残缺配对。

    历史段的消息是 ``role`` 为 ``student``/``patient`` 的 ORM 对象（或任何带
    ``role``/``content`` 属性的对象；system 已被调用方过滤）。残缺配对（只有问句、
    只有答句）各占一轮，不丢内容。
    """
    rounds: list[tuple[str, str]] = []
    question = ""
    answer = ""
    has_question = False
    for msg in messages:
        content = str(getattr(msg, "content", "") or "")
        if getattr(msg, "role", "") == "student":
            if has_question:
                rounds.append((question, answer))
                answer = ""
            question, has_question = content, True
        else:
            if answer:
                rounds.append((question, answer))
                question, has_question = "", False
            answer = content
    if has_question or answer:
        rounds.append((question, answer))
    return rounds


def summarize_rounds(messages: list, *, max_tokens: int = SUMMARY_BUDGET_TOKENS) -> str:
    """把被折叠的旧消息压成确定性摘要文本（空输入 → 空串）。

    按 token 预算从最近的旧轮次往前纳入（越近越相关），更早的以「已省略 N 轮」
    计数告知模型存在过更早的对话；预算小到放不下一轮时仍保留最近一轮 —— 信息
    只被压缩，不会凭空消失。输出是输入的纯函数：同一批消息恒定得到同一段文本。
    """
    rounds = group_rounds(messages)
    if not rounds:
        return ""

    budget = max(0, max_tokens - estimate_tokens(HISTORY_SUMMARY_HEADER))
    lines: list[str] = []
    for question, answer in reversed(rounds):
        line = _format_round(question, answer)
        cost = estimate_tokens(line) + 1
        if cost > budget and lines:
            break
        lines.append(line)
        budget -= cost
    lines.reverse()

    omitted = len(rounds) - len(lines)
    if omitted > 0:
        lines.insert(0, f"- （另有更早 {omitted} 轮已省略）")
    return "\n".join([HISTORY_SUMMARY_HEADER, *lines])
