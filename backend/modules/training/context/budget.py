"""History token budget —— 历史段的裁剪口径与选择规则（纯函数）。

数字口径（评审 R1/R4 注释修正：120 与 2000 语义不同，勿混用）：
  120    ``router/chat.py`` 的 **DB 读取窗口**（单次最多取最近 120 条消息进内存，
         目的是控制 DB I/O），**不是** LLM 上下文上限，也不参与裁剪判断；
  2000   ``HISTORY_BUDGET_TOKENS``，即 **LLM 历史段 token 预算**，才是上下文上限。
两者只是恰好同处一条链路：DB 窗口必须显著大于 LLM 预算，否则"能取到的消息"
反而成了真正的裁剪边界。

裁剪规则（评审 R1，"不砍头"）：
  - 钉住首 ``HEAD_PINNED_ROUNDS`` 轮 → 开场主诉永不丢失，且跨轮逐字节稳定；
  - 最近 ``MIN_HISTORY_ROUNDS`` 轮无条件保底，其外侧再按 token 预算逐条纳入；
  - 只从**中间**丢弃，被丢弃的中段交给 ``history_compaction.summarize_rounds``
    压成摘要文本（纯函数，不调 LLM）；摘要由调用方插入稳定的首段之后。

token 口径（评审 R4）：``estimate_tokens`` 优先用官方 tokenizer 计数（残差仅剩 API 侧
chat 模板开销，约 2%），产物不可用时降级为 0.6/0.3 的字符比例估算（低估约 10%）。
调用方若拿到 API usage，可把它传进 ``resolve_token_scale`` 按真实值收紧预算。
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from infra.llm.token_counter import estimate_tokens, reconcile_tokens

from .history_compaction import summarize_rounds

# 历史区 token 预算：固定开销（静态/会话/状态/示例）之外的余量全给历史。
HISTORY_BUDGET_TOKENS = 2000
# PER-TURN 患者状态槽位的总预算：情绪策略 + 操作注记 + 场景状态共用。
# 该槽位是"患者此刻的事实"，是每轮变化的短文本，不是资料区。
PATIENT_STATE_BUDGET_TOKENS = 300
# 尾部保护集：最近 N 轮（N*2 条消息）无条件保留，防止预算吃光关键近期上下文。
MIN_HISTORY_ROUNDS = 4
# 头部钉住轮数：开场（主诉相关）的 N 轮永不进入裁剪，跨轮逐字节稳定。
HEAD_PINNED_ROUNDS = 2
# token 比例上限：防止单次异常 usage 把历史预算压到只剩保底集。
MAX_TOKEN_SCALE = 4.0


def estimate_text_tokens(text: str) -> int:
    """单文本 token 估算（0 长度返回 0）。"""
    return estimate_tokens(text)


def resolve_token_scale(*, estimated: int | None, actual: int | None) -> float:
    """把上一轮 prompt 的估算/真实用量换算成历史计费的 token 比例（评审 R4）。

    返回 ``min(MAX_TOKEN_SCALE, max(1.0, 实际/估算))``：
    - 真实用量高于估算（启发式低估）→ 按真实比例收紧预算；
    - 真实用量低于估算 → 不放宽（预算是上限，且低估是已知的系统性偏差）；
    - ``actual is None``（API 未返回 usage）或缺省 → 回退 1.0，即纯估算，调用方
      无需分支。

    口径：usage 只给整体 prompt 用量，没有分段用量，故用整体比例校正历史段 ——
    同一会话的文本分布一致（同为中文对话），是可以接受的一阶近似。
    """
    if not estimated or actual is None:
        return 1.0
    return min(MAX_TOKEN_SCALE, max(1.0, reconcile_tokens(estimated, actual).ratio))


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
    effective_budget_tokens: int


def compact_history(
    messages: list,
    *,
    budget_tokens: int = HISTORY_BUDGET_TOKENS,
    min_rounds: int = MIN_HISTORY_ROUNDS,
    head_rounds: int = HEAD_PINNED_ROUNDS,
    token_scale: float = 1.0,
    summarizer: Callable[[list], str] = summarize_rounds,
) -> HistorySelection:
    """按 token 预算选择历史：钉住首 K 轮 + 中段摘要 + 近期尾部。

    - system 消息跳过（不进入 LLM 历史）
    - 首 ``head_rounds`` 轮（2*head_rounds 条）**无条件钉住**：这是开场主诉所在，
      且这批消息跨轮逐字节不变 → 静态前缀之后的 history 段首部可命中前缀缓存
      （旧实现从最旧端整体丢弃，导致首部每轮偏移、缓存失效）
    - 最近 ``min_rounds`` 轮无条件保底，其外侧逐条按预算从新到旧纳入，首个超预算
      消息即尾部下界
    - 首尾之间（若存在）**只从中段丢弃**，交由 ``summarizer`` 压成摘要文本
    - ``token_scale`` = 真实/估算用量的比例（见 ``resolve_token_scale``），按此比例
      折算有效预算，使预算"按真实值"而非字符比例启发式
    - ``summarizer`` 是摘要生成的接缝：默认 ``summarize_rounds``（抽取式纯函数），
      需要模型生成时由调用方注入 ``Callable[[list], str]``，本模块不接 LLM
    """
    non_system = [m for m in messages if getattr(m, "role", "") != "system"]
    total = len(non_system)

    head_end = min(total, max(0, head_rounds) * 2)
    floor = min(max(0, min_rounds) * 2, total - head_end)
    kept_from = total - floor

    effective_budget = int(budget_tokens / token_scale) if token_scale > 0 else budget_tokens
    budget = effective_budget
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
        effective_budget_tokens=effective_budget,
    )
