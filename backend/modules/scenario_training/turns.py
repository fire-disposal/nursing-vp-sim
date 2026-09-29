"""情境训练 · 回合领域模型（解析 → 结算 → 演出 三个阶段共用的形状）。

这一份是**唯一**的回合词汇表：解析阶段的输出（`IntentResolution`）、结算阶段的产物
（`ResolvedTurn`）、演出阶段的输出（`SceneDelivery`）都在这里定义。平台与两个模型阶段
共用同一组模型生成 JSON schema，**不另写一份散文枚举规范**（docs/scenario.md）。

依赖方向：本模块只依赖 `schema.py`（包声明）与 pydantic；`dm/**` 与 `runtime/**` 都可以导入它，
反向不成立——因此不会出现导入环。
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .schema import EffectOp, TargetKind, TargetRef

#: 学生消息的显示身份词汇（`ScenarioMessage` 与视图投影共用一份，避免两处字面量漂移）。
#: `declaration` 只在**未归属到声明动作**时出现：`say` = 说话的声明，`act` = 行动的声明。
MessageRole = Literal["student", "scene", "actor", "system"]
MessageKind = Literal["speech", "action", "narration", "clarification", "hint", "blocked", "unmodeled"]
DeclarationKind = Literal["say", "act"]
MessageOrigin = Literal["world", "dm", "pack", "student", "system", "hint"]

#: SSE 阶段名（冻结枚举：前端可显示人话，但不许自造新阶段名）。
TurnPhase = Literal["receiving", "parsing", "resolving", "delivering", "validating", "committing"]

__all__ = [
    "ActionEcho",
    "AppliedEffect",
    "AttemptOutcome",
    "DeclarationKind",
    "DeliveryMessage",
    "FocusState",
    "IntentKind",
    "IntentResolution",
    "MessageKind",
    "MessageOrigin",
    "MessageRole",
    "ModelsUsed",
    "ResolvedTurn",
    "SceneDelivery",
    "SocialUpdate",
    "TargetKind",
    "TargetRef",
    "TurnInput",
    "TurnPhase",
    "VisibleEvent",
]


class IntentKind(StrEnum):
    """学生这一次表达的性质。"""

    SPEECH = "speech"  # 说话 / 发问
    ACTION = "action"  # 尝试执行一件事
    CLARIFICATION = "clarification"  # 信息不足，需要学生先澄清（不结算、不推进）


class SocialUpdate(BaseModel):
    """DM 对**人物状态**的有限提案（只允许包在 `Actor.dm_writable` 里声明过的键）。"""

    model_config = ConfigDict(extra="forbid")

    key: str
    op: EffectOp = EffectOp.INCR
    value: Any = None


class IntentResolution(BaseModel):
    """解析阶段的输出：把学生的一句话（或一个按钮）说成一件**可结算**的事。"""

    model_config = ConfigDict(extra="forbid")

    kind: IntentKind
    target: TargetRef | None = None
    affordance_id: str | None = None  # 可归属的声明动作；平台仍需校验当下可用性
    selection: list[str] = Field(default_factory=list)
    utterance: str = ""  # 学生原话引用（不是模型替写的转述）
    clarification: str = ""  # 仅在 kind=clarification 时：简短问题，不含答案提示
    social_updates: list[SocialUpdate] = Field(default_factory=list)


class AttemptOutcome(StrEnum):
    """一次尝试在世界里的归宿。"""

    SPEECH = "speech"  # 纯交流
    PERFORMED = "performed"  # 动作生效
    BLOCKED = "blocked"  # 世界阻止（处境原因；消耗一个回合）
    UNMODELED = "unmodeled"  # 本包未建模的行为（诚实说明不能模拟其此类后果）
    CLARIFICATION = "clarification"  # 澄清：不进入世界结算
    HINT = "hint"  # 求提示：只读教学交互，不推进世界


class TurnInput(BaseModel):
    """学生这次请求的输入回声（请求原文，供结算、演出与教师回放读同一份）。"""

    kind: Literal["speech", "action", "hint"]
    target: TargetRef | None = None
    affordance_id: str | None = None
    selection: list[str] = Field(default_factory=list)
    text: str = ""


class AppliedEffect(BaseModel):
    """一次状态改动的旧值／新值（可回放、可解释、带来源）。"""

    key: str
    op: str = ""
    value: Any = None
    old: Any = None
    new: Any = None
    turn: int = 0
    source: str = ""  # `affordance:<id>` / `reaction:<id>` / `social:<key>`


class VisibleEvent(BaseModel):
    """本回合**已经发生且学生可见**的一件事（演出的唯一素材来源）。"""

    kind: Literal["action", "effect", "reveal", "reaction", "social", "notice", "image", "blocked", "unmodeled"]
    ref: str = ""  # 稳定引用（`action:<id>` / `effect:<key>` / `cue:<id>` / `reaction:<id>`）
    text: str = ""  # 已可见的人话描述（受众是学生，不含隐藏真相）
    turn: int = 0


class FocusState(BaseModel):
    """教学关注点**此刻**的投影：相关 / 已处理（只是本包观察条件成立，不等于能力达标）。"""

    id: str
    intent: str = ""
    relevant: bool = False
    addressed: bool = False
    evidence_refs: list[str] = Field(default_factory=list)


class ActionEcho(BaseModel):
    """这一回合学生实际做了什么（结算用回声；`outcome` 是世界的答复）。"""

    kind: Literal["speech", "action", "hint"] = "action"
    affordance_id: str | None = None
    label: str = ""
    target: TargetRef | None = None
    text: str = ""
    selection: list[str] = Field(default_factory=list)
    outcome: AttemptOutcome = AttemptOutcome.SPEECH
    block_reason: str = ""


class ResolvedTurn(BaseModel):
    """结算阶段的产物：世界这一回合**确定性地**发生了什么（内部模型，不直接给学生）。"""

    request_id: str
    base_seq: int
    turn: int  # **情境时间单位累计值**（本回合并未花时间时与上一值相同）
    time_cost: int = 0  # 本回合实际消耗的时间单位（0 = 瞬时）
    outcome: AttemptOutcome
    block_reason: str = ""
    action: ActionEcho
    effects: list[AppliedEffect] = Field(default_factory=list)
    reveals: list[str] = Field(default_factory=list)
    reactions: list[str] = Field(default_factory=list)
    social: list[AppliedEffect] = Field(default_factory=list)
    visible_events: list[VisibleEvent] = Field(default_factory=list)
    facts: list[str] = Field(default_factory=list)
    focus: list[FocusState] = Field(default_factory=list)
    problems: list[str] = Field(default_factory=list)


class DeliveryMessage(BaseModel):
    """演出输出的一条消息：环境叙述（`speaker=None`）或角色台词（`speaker=<actor id>`）。"""

    model_config = ConfigDict(extra="forbid")

    speaker: str | None = None
    as_role: str = ""  # 临时角色的显示名（`speaker` 用临时 key 时必填）
    ephemeral: bool = False
    text: str
    sources: list[str] = Field(default_factory=list)  # 只能引用本回合可见事件里的 ref


class SceneDelivery(BaseModel):
    """演出阶段的输出。**没有** effects / reveals / facts / notes / 委派字段（docs/scenario.md）。"""

    model_config = ConfigDict(extra="forbid")

    messages: list[DeliveryMessage] = Field(default_factory=list)
    hints: list[str] = Field(default_factory=list)  # 方向性提示（只在学生求助时）
    assets: list[str] = Field(default_factory=list)  # 已声明的资源 id
    highlights: list[str] = Field(default_factory=list)  # 本回合应突出的**已可见**变化引用


class ModelsUsed(BaseModel):
    """本回合实际花掉的模型调用数（两阶段成本口径，进事件与判定）。"""

    parse: int = 0
    delivery: int = 0

    @property
    def total(self) -> int:
        return self.parse + self.delivery
