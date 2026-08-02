"""context — 患者扮演的四域上下文组装（纯函数核心）。

域划分：
  STATIC      人设卡（会话不变）
  SESSION     病例（会话不变，逐字节稳定 → prefix cache）
  EXAMPLES    示例对话 few-shot 消息对（会话不变）
  HISTORY     真实对话（token 预算 + 保护集选择）
  PER-TURN    患者当前状态（每轮变化，独立 system 消息）

组装入口：``assemble_patient_messages``（见 assembler.py）。
"""

from __future__ import annotations

from .assembler import assemble_patient_messages
from .budget import HISTORY_BUDGET_TOKENS, MIN_HISTORY_ROUNDS, select_history_messages
from .examples import EXAMPLES_MARKER, MAX_EXAMPLE_PAIRS, build_example_pairs
from .leak_guard import (
    find_hidden_topic_leaks,
    get_hidden_topic_correction_note,
)
from .patient_state import PATIENT_STATE_HEADER, build_patient_state

__all__ = [
    "EXAMPLES_MARKER",
    "HISTORY_BUDGET_TOKENS",
    "MAX_EXAMPLE_PAIRS",
    "MIN_HISTORY_ROUNDS",
    "PATIENT_STATE_HEADER",
    "assemble_patient_messages",
    "build_example_pairs",
    "build_patient_state",
    "find_hidden_topic_leaks",
    "get_hidden_topic_correction_note",
    "select_history_messages",
]
