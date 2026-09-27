"""患者上下文**策略与历史预算**的唯一 owner（纯函数 + 冻结策略对象）。

数字口径（勿混用）：
  120    ``router/chat.py`` 的 **DB 读取窗口**（单次最多取最近 120 条消息进内存，
         目的是控制 DB I/O），**不是** LLM 上下文上限，也不参与裁剪判断；
  ``ContextPolicy.history_budget_tokens`` 才是 **LLM 历史段 token 预算**，是这里
         唯一的裁剪上限。
两者只是恰好同处一条链路：DB 窗口必须显著大于 LLM 预算，否则"能取到的消息"
反而成了真正的裁剪边界。

裁剪规则（评审 R1，"不砍头"）：
  - 钉住首 ``head_pinned_rounds`` 轮 → 开场主诉永不丢失，且跨轮逐字节稳定；
  - 最近 ``min_history_rounds`` 轮无条件保底，其外侧再按 token 预算逐条纳入；
  - 只从**中间**丢弃，被丢弃的中段交给 ``history_compaction.summarize_rounds``
    压成摘要文本（纯函数，不调 LLM）；摘要由调用方插入稳定的首段之后。

token 口径（评审 R4）：``estimate_tokens`` 优先用官方 tokenizer 计数（残差仅剩 API 侧
chat 模板开销，约 2%），产物不可用时降级为 0.6/0.3 的字符比例估算（低估约 10%）。
**不做**按上一轮 API usage 反推的自适应收紧：那条链路没有生产接线（上一轮真实用量
停在 ``llm_call_logs``，从不回流到装配），留半截参数只会让"预算按真实值走"的承诺与
实际不符。真实用量仍可逐条从调用日志核对。
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from infra.llm.token_counter import estimate_tokens

from .history_compaction import summarize_rounds


@dataclass(frozen=True)
class ContextPolicy:
    """患者消息装配策略 —— 决定"每轮把什么放进 prompt、先裁谁"。

    这是策略数值的唯一 owner：装配入口只接受一个 ``ContextPolicy``，不再散着传
    四个可能互相不一致的 kwarg。冻结进 ``training_records.context_policy_version``
    （见 ``prompt_identity.compute_context_policy_version``），改任一字段即改身份。

    已知边界：**算法**改动不在字段里（见 ``compiler.COMPILER_SCHEMA``）。
    """

    #: 历史段 token 预算：固定开销（人设卡/病例/示例/状态）之外的余量全给历史。
    history_budget_tokens: int = 2000
    #: PER-TURN 患者状态槽位的总预算：情绪策略 + 操作注记 + 场景状态共用。
    #: 该槽位是"患者此刻的事实"，是每轮变化的短文本，不是资料区。
    patient_state_budget_tokens: int = 300
    #: 尾部保护集：最近 N 轮（N*2 条消息）无条件保留，防止预算吃光关键近期上下文。
    min_history_rounds: int = 4
    #: 头部钉住轮数：开场（主诉相关）的 N 轮永不进入裁剪，跨轮逐字节稳定。
    head_pinned_rounds: int = 2


#: 生产策略。调用方需要别的数值时用 ``dataclasses.replace`` 派生，不改这个对象。
DEFAULT_POLICY = ContextPolicy()


def estimate_text_tokens(text: str) -> int:
    """单文本 token 估算（0 长度返回 0）。"""
    return estimate_tokens(text)


@dataclass(frozen=True)
class HistorySelection:
    """历史段的选择结果（按时间顺序分三段）。

    ``head`` + ``tail`` 是逐字保留的消息（保持原对象）；``summarized`` 是被折进
    ``summary`` 的中段消息（不进入 messages，供调用方审计/日志）；``summary`` 为空
    表示没有中段（历史未饱和，与旧行为逐字节一致）。
    """

    head: list
    tail: list
    summarized: list
    summary: str


def compact_history(
    messages: list,
    *,
    policy: ContextPolicy = DEFAULT_POLICY,
    summarizer: Callable[[list], str] = summarize_rounds,
) -> HistorySelection:
    """按 ``policy`` 选择历史：钉住首 K 轮 + 中段摘要 + 近期尾部。

    - system 消息跳过（不进入 LLM 历史）
    - 首 ``head_pinned_rounds`` 轮（2*K 条）**无条件钉住**：这是开场主诉所在，
      且这批消息跨轮逐字节不变 → 静态前缀之后的 history 段首部可命中前缀缓存
      （旧实现从最旧端整体丢弃，导致首部每轮偏移、缓存失效）
    - 最近 ``min_history_rounds`` 轮无条件保底，其外侧逐条按预算从新到旧纳入，
      首个超预算消息即尾部下界
    - 首尾之间（若存在）**只从中段丢弃**，交由 ``summarizer`` 压成摘要文本
    - ``summarizer`` 是摘要生成的接缝：默认 ``summarize_rounds``（抽取式纯函数），
      需要模型生成时由调用方注入 ``Callable[[list], str]``，本模块不接 LLM
    """
    non_system = [m for m in messages if getattr(m, "role", "") != "system"]
    total = len(non_system)

    head_end = min(total, max(0, policy.head_pinned_rounds) * 2)
    floor = min(max(0, policy.min_history_rounds) * 2, total - head_end)
    kept_from = total - floor

    budget = policy.history_budget_tokens
    for i in range(kept_from - 1, head_end - 1, -1):
        cost = estimate_text_tokens(str(getattr(non_system[i], "content", "")))
        if cost > budget:
            break
        budget -= cost
        kept_from = i

    summarized = non_system[head_end:kept_from]
    return HistorySelection(
        head=non_system[:head_end],
        tail=non_system[kept_from:],
        summarized=summarized,
        summary=summarizer(summarized) if summarized else "",
    )


__all__ = [
    "DEFAULT_POLICY",
    "ContextPolicy",
    "HistorySelection",
    "compact_history",
    "estimate_text_tokens",
]
