"""情境训练 · 回合领域模型（结算 → 模型循环 → 提交 共用的形状）。

一条回合管线的产物：**平台确定性地结算**（`ResolvedTurn`）→ **模型在环境里做事的步骤账**
（`ToolStep`）→ **最终交付**（`SceneDelivery`）。三者一起折进一条 `turn_committed` 的载荷。
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field

from .schema import EffectOp, TargetKind, TargetRef

#: 学生消息的显示身份词汇（`ScenarioMessage` 与视图投影共用一份，避免两处字面量漂移）。
#: `declaration` 只在**未归属到声明动作**时出现：`say` = 说话的声明，`act` = 行动的声明。
MessageRole = Literal["student", "scene", "actor", "system"]
MessageKind = Literal["speech", "action", "narration", "clarification", "hint", "blocked", "unmodeled"]
DeclarationKind = Literal["say", "act"]
MessageOrigin = Literal["world", "dm", "pack", "student", "system", "hint"]

#: SSE 阶段名（冻结枚举：前端可显示人话，但不许自造新阶段名）。
#: 单循环 runtime 只有四个**真实**阶段：接单 → 平台结算 → 模型循环（演绎/交付） → 原子提交。
TurnPhase = Literal["receiving", "resolving", "delivering", "committing"]

__all__ = [
    "ActionEcho",
    "AppliedEffect",
    "AttemptOutcome",
    "DeclarationKind",
    "DeliveryMessage",
    "MessageKind",
    "MessageOrigin",
    "MessageRole",
    "ModelCalls",
    "ResolvedTurn",
    "SceneDelivery",
    "TargetKind",
    "TargetRef",
    "ToolStep",
    "TurnInput",
    "TurnPhase",
]


class AttemptOutcome(StrEnum):
    """一次尝试在世界里的归宿。"""

    CLARIFICATION = "clarification"  # 信息不足（多对象歧义），先澄清：不结算、不推进时间
    SPEECH = "speech"  # 纯交流：世界如实回应，不消耗资源
    PERFORMED = "performed"  # 声明动作已执行（效果/揭示按包声明结算）
    BLOCKED = "blocked"  # 已知但当下不可达：算一次实际尝试，消耗回合
    UNMODELED = "unmodeled"  # 包里没有这件事：诚实说没有建模
    HINT = "hint"  # 求提示：只读教学交互，不推进世界


class TurnInput(BaseModel):
    """学生这次请求的输入回声（请求原文，供结算、交付与教师回放读同一份）。"""

    kind: Literal["speech", "action", "hint"] = "speech"
    target: TargetRef | None = None
    affordance_id: str | None = None
    selection: list[str] = Field(default_factory=list)
    text: str = ""


class AppliedEffect(BaseModel):
    """一次状态改动的旧值／新值（可回放、可解释、带来源）。"""

    key: str
    op: str = EffectOp.SET.value
    value: Any = None
    old: Any = None
    new: Any = None
    turn: int = 0
    source: str = ""  # `affordance:<id>` / `tool:<name>`


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


class ToolStep(BaseModel):
    """模型在环境里做的一件事（**记账**，不是思考过程）。

    `ok=False` 时 `reason` 是机器可读的拒绝原因（`key_unregistered` / `out_of_range` /
    `image_gated` / `text_leak` …），`detail` 是给模型看的那句话——两者都进事件载荷，
    /api/diagnose 与教师回放按 `reason` 计数。
    """

    tool: str
    args: dict[str, Any] = Field(default_factory=dict)
    ok: bool = True
    reason: str = ""
    detail: str = ""


class DeliveryMessage(BaseModel):
    """交付的一条消息：环境叙述（`speaker=None`）或角色台词（`speaker=<actor id>`）。"""

    speaker: str | None = None
    as_role: str = ""
    ephemeral: bool = False
    text: str = ""


class SceneDelivery(BaseModel):
    """本回合的最终交付（学生看到的话）。由模型循环产出，平台逐条校验后收下。"""

    messages: list[DeliveryMessage] = Field(default_factory=list)


class ResolvedTurn(BaseModel):
    """**平台确定性地**结算的产物：世界这一回合发生了什么（内部模型，不直接给学生）。"""

    request_id: str = ""
    base_seq: int = 0
    turn: int = 0
    time_cost: int = 0
    outcome: AttemptOutcome = AttemptOutcome.SPEECH
    block_reason: str = ""
    action: ActionEcho = Field(default_factory=ActionEcho)
    effects: list[AppliedEffect] = Field(default_factory=list)
    reveals: list[str] = Field(default_factory=list)
    facts: list[str] = Field(default_factory=list)
    problems: list[str] = Field(default_factory=list)


class ModelCalls(BaseModel):
    """本回合花掉的模型调用数（工具循环的轮数，**一个循环、一个计数**）。"""

    calls: int = 0
