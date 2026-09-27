"""context —— 患者扮演上下文：编译入口 + 策略 + 类型化片段。

域划分（布局与不变量见 ``compiler`` 模块 docstring）：

  ROLE / SCENARIO   人设卡与病例（会话不变；内核保留槽位，不接受任何贡献）
  EXAMPLES          示例对话 few-shot 消息对（会话不变）
  HISTORY           真实对话：钉住首 K 轮 + 中段摘要 + 近期尾部（``budget.compact_history``）
  PATIENT_STATE     患者当前状态（每轮变化，独立 system 消息）
  GUARD             出站守卫修正（只允许内核来源，尾部追加）

入口：``compiler.compile_patient_prompt``（唯一装配者：槽位校验 / 选择 / 排序 / 裁剪 /
预算 / 落位）。各域只生产类型化片段（``ContextFragment``），不得自行拼接 system prompt。
策略数值（预算、保底轮、钉轮）的唯一 owner 是 ``budget.ContextPolicy``。
"""

from __future__ import annotations

from .budget import (
    DEFAULT_POLICY,
    ContextPolicy,
    HistorySelection,
    compact_history,
    estimate_text_tokens,
)
from .case_vars import build_case_vars
from .compiler import (
    COMPILER_SCHEMA,
    PATIENT_STATE_HEADER,
    append_guard_fragments,
    build_patient_state,
    compile_patient_prompt,
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

__all__ = [
    "COMPILER_SCHEMA",
    "DEFAULT_POLICY",
    "EXAMPLES_MARKER",
    "GUARD_SOURCES",
    "HISTORY_SUMMARY_HEADER",
    "MAX_EXAMPLE_PAIRS",
    "PATIENT_STATE_HEADER",
    "SOURCE_GUARD_HIDDEN_TOPIC",
    "SOURCE_GUARD_IDENTITY",
    "SUMMARY_BUDGET_TOKENS",
    "ContextFragment",
    "ContextPolicy",
    "ContextSlot",
    "HistorySelection",
    "append_guard_fragments",
    "build_case_vars",
    "build_example_pairs",
    "build_patient_state",
    "compact_history",
    "compile_patient_prompt",
    "estimate_text_tokens",
    "find_hidden_topic_leaks",
    "get_hidden_topic_correction_note",
    "group_rounds",
    "summarize_rounds",
]
