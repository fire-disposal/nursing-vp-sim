"""context — 患者扮演的四域上下文组装（纯函数核心 + 唯一装配者）。

域划分：
  STATIC      人设卡（会话不变）
  SESSION     病例（会话不变，逐字节稳定 → prefix cache）
  EXAMPLES    示例对话 few-shot 消息对（会话不变）
  HISTORY     真实对话。钉住首 K 轮 + 近期尾部逐字保留，中段压缩成摘要（见
              budget.compact_history / history_compaction.summarize_rounds）
  PER-TURN    患者当前状态（每轮变化，独立 system 消息）

组装入口：``assemble_patient_messages``（纯函数，见 assembler.py）与
``ContextAssembler``（唯一装配者：声明校验 / 选择 / 排序 / 裁剪 / 预算，docs/15 §八）。
各域只生产类型化片段（``ContextFragment``），不得自行拼接 system prompt。
"""

from __future__ import annotations

from .assembler import (
    AssemblyResult,
    ContextAssembler,
    append_guard_fragments,
    assemble_patient_messages,
)
from .budget import (
    HEAD_PINNED_ROUNDS,
    HISTORY_BUDGET_TOKENS,
    MAX_TOKEN_SCALE,
    MIN_HISTORY_ROUNDS,
    PATIENT_STATE_BUDGET_TOKENS,
    HistorySelection,
    compact_history,
    resolve_token_scale,
)
from .examples import EXAMPLES_MARKER, MAX_EXAMPLE_PAIRS, build_example_pairs
from .fragment import (
    GUARD_SOURCES,
    SOURCE_GUARD_HIDDEN_TOPIC,
    SOURCE_GUARD_IDENTITY,
    ContextFragment,
    ContextSlot,
)
from .history_compaction import (
    HISTORY_SUMMARY_HEADER,
    SUMMARY_BUDGET_TOKENS,
    group_rounds,
    summarize_rounds,
)
from .leak_guard import (
    find_hidden_topic_leaks,
    get_hidden_topic_correction_note,
)
from .patient_state import PATIENT_STATE_HEADER, build_patient_state

__all__ = [
    "EXAMPLES_MARKER",
    "GUARD_SOURCES",
    "HEAD_PINNED_ROUNDS",
    "HISTORY_BUDGET_TOKENS",
    "HISTORY_SUMMARY_HEADER",
    "MAX_EXAMPLE_PAIRS",
    "MAX_TOKEN_SCALE",
    "MIN_HISTORY_ROUNDS",
    "PATIENT_STATE_BUDGET_TOKENS",
    "PATIENT_STATE_HEADER",
    "SOURCE_GUARD_HIDDEN_TOPIC",
    "SOURCE_GUARD_IDENTITY",
    "SUMMARY_BUDGET_TOKENS",
    "AssemblyResult",
    "ContextAssembler",
    "ContextFragment",
    "ContextSlot",
    "HistorySelection",
    "append_guard_fragments",
    "assemble_patient_messages",
    "build_example_pairs",
    "build_patient_state",
    "compact_history",
    "find_hidden_topic_leaks",
    "get_hidden_topic_correction_note",
    "group_rounds",
    "resolve_token_scale",
    "summarize_rounds",
]
