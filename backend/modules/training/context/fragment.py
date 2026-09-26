"""类型化上下文片段（docs/15 §八）。

各域（NoteSource / Activity / 守卫）只**生产**有类型的片段；选择、排序、裁剪、预算
一律由 :class:`~modules.training.context.assembler.ContextAssembler` 决定。禁止
router / 中间件 / handler 直接拼接任意 system prompt 字符串。

槽位（``ContextSlot``）就是「谁能写哪一段」：
  ``ROLE`` / ``SCENARIO`` 由内核渲染（Workflow 声明的模板 + 病例数据），**不接受
  任何贡献** —— 患者身份与病例事实不可被 Activity 覆盖；
  ``PATIENT_STATE`` 开放给声明过的来源（Workflow 的 note_sources + 本次启用
  Activity 的 ``context_contribution.key``）；
  ``GUARD`` 只接受内核守卫来源（身份泄漏 / 隐藏主题），且只能追加到消息尾部重试。
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class ContextSlot(StrEnum):
    ROLE = "role"
    SCENARIO = "scenario"
    PATIENT_STATE = "patient_state"
    GUARD = "guard"


@dataclass(frozen=True)
class ContextFragment:
    """一个待装配的类型化上下文片段（不含位置决策）。"""

    source: str
    slot: ContextSlot
    text: str
    priority: int = 0
    #: 本源声明的单片段上限（token）；装配器还会叠加槽位总预算
    max_tokens: int | None = None


#: 出站守卫：只允许它们贡献 GUARD 槽位（安全边界不可由 Activity 扩展）
SOURCE_GUARD_IDENTITY = "guard.identity"
SOURCE_GUARD_HIDDEN_TOPIC = "guard.hidden_topic"

GUARD_SOURCES: frozenset[str] = frozenset({SOURCE_GUARD_IDENTITY, SOURCE_GUARD_HIDDEN_TOPIC})
