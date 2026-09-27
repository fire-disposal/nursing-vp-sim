"""情境层（situation）——训练上下文发布的**作者面**，比「病例」高一层。

## 为什么要有这一层

现在的作者面是「一个患者的一次问诊」：字段有 `patient_info` / `chief_complaint` / `example_dialogues` /
`required_inquiries`，评审的判据是"问全了没有"。这条路的两头都别扭：信息采集本身接近照目录问，
而复杂临床推理的输入（化验、监护、同事交班、家属、病情随时间变化）**根本不在对话里**。

情境层把训练单位从"一次问诊"换成"**一次情境**"：

```
situation
 ├─ learner      学生角色 + 可做的事（affordances：问 / 查 / 测 / 记录 / 上报 / 交接 …）
 ├─ actors[]     在场者（患者 / 家属 / 同事 / 电话另一端…）：各自知道什么、怎么表现、通过什么媒介
 ├─ environment  环境与**可见**线索（含可见体征；数字只能由 affordance 产出）
 ├─ state        可读写的状态（体征、隐藏事实的曝露、任务进展）——状态只有这一个 owner
 ├─ timeline[]   触发式推进（回合数 / 经过时间 / 条件 → 状态补丁 + 事件 + 谁开口）
 ├─ evidence     什么算证据：任何由 affordance 产生的状态变化或消息，自动带来源与时间
 └─ judgment[]   判读维度与锚点（现行 rubric 只是其中一种实例）
```

「问诊」于是变成**一种情境模板**（一个在场者 + 对话 affordance + 基于采集的判读），
而不是唯一的形态。

## 契约（改这里就要改这条）

1. **一个事实一个 owner**：状态只在 `state`；`timeline` 只改 `state`；`actor` 不直接改状态（它只是表现）。
2. **只应用声明，不猜**：解释器不做隐式改写，不从自由文本反推状态。
3. **缺省 = 今天的行为**（迁移靠这条保证）：没有 `timeline`、只有一个 `actor`、`affordances` 只含
   对话/查体/记录时，语义必须与现行 `history_taking` **逐字节一致**。
4. **可见与可测的边界**：环境里可以声明定性可见线索（如 `breathing: labored`），
   数字（HR/SpO2/…）只能由 affordance 产出 —— 不能开局就把答案摊在屏幕上。
5. **判读维度由情境声明**；没有声明就退化为"只记录、不判读"，不编造评分。
6. **身份照旧**：情境是内容，仍走 `CaseRevision` + 指纹 + 批次 —— 发布器不动。
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

#: 未知键原样往返：作者面允许先写、后解释（与病例 schema 同策）
_CFG = ConfigDict(extra="allow")


class Affordance(BaseModel):
    """学生在情境里**能做的一件事**（不是"一个工具"）。

    `key` 是稳定词汇（`ask` / `examine` / `measure` / `record` / `escalate` / `handover` / `order`…），
    前端据此渲染，未注册的 key 必须**显式报错**而不是静默消失。
    `targets` 指明它可以作用在谁身上（在场者 id 或 `sources` id）。
    `effects` 声明它改 `state` 的哪些键（解释器据此记账，不从结果文本猜）。
    """

    model_config = _CFG

    key: str
    label: str = ""
    targets: list[str] = Field(default_factory=list)
    effects: list[str] = Field(default_factory=list)
    config: dict[str, Any] = Field(default_factory=dict)


class Actor(BaseModel):
    """在场者：一个**有知识边界**的对话对象。

    - `knows` / `unaware`：他知道的与不知道的（后者就是原来的隐藏事实，只是现在按人分）；
    - `behavior`：性格档（沿用现行六维键名，便于复用患者提示词）；
    - `medium`：他在场的方式（`in_person` / `phone` / `message` / `document`）——
      决定前端把它放在"现场"还是"消息/文书"通道；
    - `opening`：他先开口说什么（可空）。
    """

    model_config = _CFG

    id: str
    name: str = ""
    role: str = ""
    medium: Literal["in_person", "phone", "message", "document"] = "in_person"
    knows: list[str] = Field(default_factory=list)
    unaware: list[str] = Field(default_factory=list)
    behavior: dict[str, str] = Field(default_factory=dict)
    visible: dict[str, Any] = Field(default_factory=dict)
    opening: str = ""


class TimelineStep(BaseModel):
    """情境的**时间推进**：满足 `when` 时，应用 `patch`、可选让某人开口、可选抛事件。

    触发条件只允许**可观测**的量（回合数、经过秒数、状态取值），不允许"猜学生意图"。
    """

    model_config = _CFG

    id: str
    when: dict[str, Any] = Field(default_factory=dict)
    patch: dict[str, Any] = Field(default_factory=dict)
    speaker: str | None = None
    say: str = ""
    event: dict[str, Any] | None = None
    once: bool = True


class JudgmentDimension(BaseModel):
    """判读维度：这一次要看的**是什么**，以及锚点在哪。

    现行 rubric 是它的一个实例（维度 + 条目 + 原始刻度）；情境可以只声明维度而不声明条目，
    此时退化为"只记录证据、不评分"。
    """

    model_config = _CFG

    id: str
    label: str = ""
    anchors: list[str] = Field(default_factory=list)
    evidence: list[str] = Field(default_factory=list)


class Situation(BaseModel):
    """一个情境 = 作者面的一份文档（将来落在 `CaseRevision.content`）。"""

    model_config = _CFG

    schema_version: int = 1
    title: str = ""
    brief: str = ""
    learner: dict[str, Any] = Field(default_factory=dict)
    actors: list[Actor] = Field(default_factory=list)
    environment: dict[str, Any] = Field(default_factory=dict)
    state: dict[str, Any] = Field(default_factory=dict)
    timeline: list[TimelineStep] = Field(default_factory=list)
    affordances: list[Affordance] = Field(default_factory=list)
    judgment: list[JudgmentDimension] = Field(default_factory=list)
