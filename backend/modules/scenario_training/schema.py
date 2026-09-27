"""情境训练 · 场景单元（ScenarioPack）声明模型与词汇表。

本模块是「情境训练」实验特性的一部分，与 `modules/training/**` 完全隔离：
只允许依赖标准库、三方库、`infra/**`、`modules.auth` 与自身（见 tests/scenario_training）。

词汇表（实用主义定稿，docs/20 §六）：
- **动作类型（封闭 6 种）**：ask / observe / measure / act / document / summon
- **效果操作（封闭 3 种）**：set / incr / decr —— 只能改本 pack 自己登记的状态键
- **触发子句（封闭 7 种）**：动作与状态谓词，由**动作**驱动，不由墙钟驱动
- **决策点规则（封闭 5 种）**：判读挂在规则上，规则可复算
- **呈现原语（封闭）**：由前端按 type 通用渲染，本文件只声明数据形态

包只声明**观察**，不含分数。
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

PACK_SCHEMA_VERSION = 2
"""包声明形状版本。**删除/重命名字段必须升版**：历史修订要永远可读（见 pack_loader 的裁剪加载）。
v2：移除 `Cue.revealed_by` / `Player.attention_per_turn` / `Affordance.ineffective`（改由 reveals 与效果表达）。
"""

# --------------------------------------------------------------------------- #
# 封闭词汇表
# --------------------------------------------------------------------------- #


class AffordanceType(StrEnum):
    """动作类型。类型封闭（平台承担语义），参数与文案开放。"""

    ASK = "ask"  # 向在场者发问（自由文本）
    OBSERVE = "observe"  # 查看/注意（只读揭示）
    MEASURE = "measure"  # 取数值（读数卡）
    ACT = "act"  # 施加动作（按钮，可带选项集）
    DOCUMENT = "document"  # 产出记录（表单/自由文本）
    SUMMON = "summon"  # 呼叫/拉人（改变在场者）


class EffectOp(StrEnum):
    SET = "set"
    INCR = "incr"
    DECR = "decr"


# DM 常用的等价写法 → 规范操作（见 Effect._normalize_op）
#
# 依据实测（2026-09-27，57 次真实 DM 调用）：op 的分布是
#   set 58 / add 17 / incr 4 / decr 4 / sub 1 / delta 1
# ——即 **`add` 是 DM 的第二常用写法**，其余字段名与 options.type 全部与契约一致（无偏差、无非法 JSON）。
# 结论：平台适配 DM 的既有习惯（用户裁定），只在这里做等价归一，不改契约、不让 DM 迁就枚举。
_OP_ALIASES: dict[str, EffectOp] = {
    "set": EffectOp.SET,
    "=": EffectOp.SET,
    "assign": EffectOp.SET,
    "incr": EffectOp.INCR,
    "add": EffectOp.INCR,
    "+": EffectOp.INCR,
    "+=": EffectOp.INCR,
    "increase": EffectOp.INCR,
    "decr": EffectOp.DECR,
    "sub": EffectOp.DECR,
    "subtract": EffectOp.DECR,
    "-": EffectOp.DECR,
    "-=": EffectOp.DECR,
    "decrease": EffectOp.DECR,
}


class ClauseKind(StrEnum):
    """触发子句的封闭集合（全部 AND 组合，可选窗口）。"""

    ACTION_USED = "action_used"  # 学生用过某 affordance
    ACTION_COUNT_GTE = "action_count_gte"  # 某 affordance 累计使用 ≥ n
    TURNS_WITHOUT_ACTION = "turns_without_action"  # 连续 n 回合未用某 affordance
    CUE_REVEALED = "cue_revealed"  # 某线索已被揭示
    STATE_CMP = "state_cmp"  # 状态键比较（<, <=, ==, >=, >）
    FACT_DECLARED = "fact_declared"  # 某事实已被学生采集到
    TURN_GTE = "turn_gte"  # 回合数 ≥ n（学生每做一件事 = 一回合）


class JudgeRuleKind(StrEnum):
    """决策点判读规则的封闭集合。规则只读事件与状态，可复算、可解释。"""

    FIRST_ACTION = "first_action"  # 第一个动作属于/不属于某集合
    AVOID_REPEAT = "avoid_repeat"  # 未重复无效动作
    REQUIRE_WITHIN = "require_within"  # 在 n 回合内做了某动作
    ACTION_SET_COVERS = "action_set_covers"  # 动作集合覆盖要求（可选必做项）
    ACTION_ORDER = "action_order"  # 动作先后顺序（A 应早于 B）
    OPTION_CHOICE = "option_choice"  # 选择型动作：选了哪一项（可被自输入认领）


class Presence(StrEnum):
    ON_SITE = "on_site"
    REMOTE = "remote"
    CALLABLE = "callable"
    INACCESSIBLE = "inaccessible"


class Demand(StrEnum):
    LOUD = "loud"
    QUIET = "quiet"
    NEUTRAL = "neutral"


class FactKind(StrEnum):
    MEASURED = "measured"  # 量出来的
    REPORTED = "reported"  # 患者/他人口述的


class Anchor(StrEnum):
    STRONG = "strong"
    ADEQUATE = "adequate"
    MISSED = "missed"


class DimAgg(StrEnum):
    COVERAGE = "coverage"
    SLOPE = "slope"
    LATENCY = "latency"
    COUNT = "count"


class PanelType(StrEnum):
    TIMELINE = "timeline"
    EMOTION = "emotion"
    COVERAGE = "coverage"


class PackState(StrEnum):
    EXPERIMENTAL = "experimental"  # 允许犯错：可直接分发，门禁只报风险
    REVIEWED = "reviewed"


# --------------------------------------------------------------------------- #
# 动作与效果
# --------------------------------------------------------------------------- #


class Effect(BaseModel):
    """动作或反应对处境的影响。`target` 是 actor id 或 `scene`。"""

    model_config = ConfigDict(extra="forbid")

    target: str
    key: str  # 必须是 pack 登记过的状态键（含 <target>.trust 之类的派生键）
    op: EffectOp = EffectOp.SET
    value: Any

    @field_validator("op", mode="before")
    @classmethod
    def _normalize_op(cls, raw: Any) -> Any:
        """容忍 DM 的自然写法（add/sub/+=/…）——少一次因枚举失败而白花的重试。"""
        if isinstance(raw, str):
            alias = _OP_ALIASES.get(raw.strip().lower())
            if alias is not None:
                return alias
        return raw

    @model_validator(mode="before")
    @classmethod
    def _normalize_delta(cls, data: Any) -> Any:
        """`op: "delta"`（带符号的增量）按 value 的符号归一到 incr/decr。"""
        if isinstance(data, dict) and str(data.get("op", "")).strip().lower() in {"delta", "adjust", "change"}:
            value = data.get("value")
            sign = "incr" if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0 else "decr"
            return {**data, "op": sign}
        return data


class Clause(BaseModel):
    """单个触发子句。"""

    model_config = ConfigDict(extra="forbid")

    kind: ClauseKind
    affordance_id: str | None = None
    cue_id: str | None = None
    fact_id: str | None = None
    key: str | None = None
    op: Literal["<", "<=", "==", ">=", ">"] | None = None
    value: Any = None
    count: int | None = None
    turns: int | None = None


class Trigger(BaseModel):
    """触发条件 = 全部子句 AND。空触发视为「每次动作后都检查」。"""

    model_config = ConfigDict(extra="forbid")

    all: list[Clause] = Field(default_factory=list)


class Affordance(BaseModel):
    """学生可做的事。类型封闭，参数与文案开放。"""

    model_config = ConfigDict(extra="forbid")

    id: str
    type: AffordanceType
    label: str
    params: dict[str, Any] = Field(default_factory=dict)
    visible_when: Trigger | None = None
    effects: list[Effect] = Field(default_factory=list)
    perceptible_by: list[str] = Field(default_factory=list)
    reveals: list[str] = Field(default_factory=list)
    # 二次确认（危险动作）
    confirm: bool = False
    # 选择形态：none=直接执行；single/multi=需选择 params.options 中的一项或多项
    select: Literal["none", "single", "multi"] = "none"
    # 自输入恒在（平台保证，见 §九）：与 omp 提问工具的 "Other (type your own)" 同构
    # pack/DM **不得**自行提供"其他/自输入"选项；此开关只允许作者显式关闭自输入
    free_input: bool = True


class Reaction(BaseModel):
    """由动作/状态谓词触发的事件（**不由墙钟触发**）。"""

    model_config = ConfigDict(extra="forbid")

    id: str
    when: Trigger
    by: str  # actor id
    does: Literal["say", "do", "withhold", "leave", "escalate"]
    intent: str
    effects: list[Effect] = Field(default_factory=list)
    reveals: list[str] = Field(default_factory=list)
    once: bool = True  # 默认只触发一次


# --------------------------------------------------------------------------- #
# 处境：在场者与场景
# --------------------------------------------------------------------------- #


class Actor(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    role: str
    presence: Presence = Presence.ON_SITE
    knowledge: dict[str, Any] = Field(default_factory=dict)  # 知道什么 = 防泄漏边界
    style: str = ""
    goals: list[str] = Field(default_factory=list)
    demand: Demand = Demand.NEUTRAL
    # 预留：该角色由**独立 LLM 对话实体**代言（而不是由 DM 一肩挑）。
    # inline = DM 直接产出其台词；dedicated = DM 只决定"何时让它说、意图是什么"，
    # 台词由该实体自己的调用产出（purpose = st_patient）。默认 inline，不改现有行为。
    entity: Literal["inline", "dedicated"] = "inline"


class Cue(BaseModel):
    """可见线索。由**动作的 `reveals`**或触发式反应揭示——线索本身不声明来源。"""

    model_config = ConfigDict(extra="forbid")

    id: str
    text: str
    visible_from_start: bool = False


class Asset(BaseModel):
    """场景资源包内的预定义资源（由**场景准备者**预先准备，DM 按需展示）。

    领域中立：平台只知道"有一张图、什么时候值得展示"，不知道图里是什么。
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    kind: Literal["image"] = "image"
    path: str = ""  # 仓库播种来源：assets/<pack_key>/<path>（可留空，由管理侧上传字节）
    title: str = ""
    alt: str = ""  # 无障碍与"看不到图也能用"
    suggest_when: str = ""  # 给 DM 的自然语言提示：什么时候值得展示（不是触发器）


class Setting(BaseModel):
    model_config = ConfigDict(extra="forbid")

    place: str
    time_hint: str = ""
    cues: list[Cue] = Field(default_factory=list)
    resources: list[str] = Field(default_factory=list)


class Player(BaseModel):
    """学生也是场景中的角色。"""

    model_config = ConfigDict(extra="forbid")

    role: str
    can: list[AffordanceType] = Field(default_factory=lambda: list(AffordanceType))


# --------------------------------------------------------------------------- #
# 任务：叙事锚点（DM 的「任务列表」，docs/21 §4.0）
# --------------------------------------------------------------------------- #


class NarrativeAnchor(BaseModel):
    """叙事锚点：场景推进路上的一个关键节点（**不是分数**）。

    它是 DM 的**任务列表**（docs/21 §4.0）：状态由平台每回合从事件流重算（`runtime/anchors.py`），
    不新增真源；`requires` / `blocked_by` / `unlocks` 只能引用**已登记**的事实与动作 id。
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    stage: str  # 阶段名：锚点按阶段分组，同时只推进一个阶段
    goal: str  # 教学意图（只给 DM 与教师回放看，学生看不到）
    cue: str  # 世界必须呈现的信号（只能用叙事内手段表达）
    requires: list[str] = Field(default_factory=list)  # 前置：这些事实/动作已发生
    unlocks: list[str] = Field(default_factory=list)  # 达成后开放的动作
    blocked_by: list[str] = Field(default_factory=list)  # 缺哪一步就卡住（世界要诚实抵抗）
    deadline_turns: int  # 超过 N 回合未达成 → 引擎催办（有预算）


# --------------------------------------------------------------------------- #
# 判读：只声明观察
# --------------------------------------------------------------------------- #


class FactSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    intent: str  # 意图描述（给抽取用；**不得出现在按钮文案里**）
    kind: FactKind = FactKind.REPORTED
    critical: bool = False
    # 作者显式声明的禁用词：按钮/选项文案中出现即视为泄底（§十三 验收句 2）
    banned_phrases: list[str] = Field(default_factory=list)
    # 该事实"被采集到"的可观测判据（判读只读世界事实，不读 DM 的自述）：
    # 揭示过其中任一线索，或使用过其中任一动作，即视为已采集。
    cue_ids: list[str] = Field(default_factory=list)
    affordance_ids: list[str] = Field(default_factory=list)


class Criterion(BaseModel):
    """**本场景自己写的一条 rubric**：判据（封闭规则）+ 三档锚点 + **权重（1–100 的整数）**。

    与"通用方案"的区别：每条判据由作者按这个场景的需要写，权重也由作者定；
    平台只做可复算的求值，并把结果汇总成**得分率**。
    经验口径：**每个包的权重合计 = 100**，作者与教师都能心算（如 `10 10 80`）。
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    title: str  # 一句话说清这条在评什么（进报告，不进 DM 提示词）
    rule: JudgeRuleKind
    params: dict[str, Any] = Field(default_factory=dict)
    anchors: dict[Anchor, str]
    weight: int = Field(default=1, ge=1, le=100)  # 正整数 1–100；平台侧用，LLM 看不见
    score_map: dict[Anchor, float] = Field(
        default_factory=lambda: {Anchor.STRONG: 1.0, Anchor.ADEQUATE: 0.5, Anchor.MISSED: 0.0}
    )


class DimSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    label: str
    agg: DimAgg
    source: Literal["facts", "actions", "state"] = "actions"
    # 维度参数（领域中立）：latency 用 affordances；slope 用 key；coverage 可留空
    params: dict[str, Any] = Field(default_factory=dict)


# --------------------------------------------------------------------------- #
# 呈现
# --------------------------------------------------------------------------- #


class HudSlot(BaseModel):
    """HUD 槽位：**声明潜力，条件决定出现**。

    `visible_when` 为空 = 一直可见（例如病房里本就摆着的监护仪读数）；
    写了触发器则由条件决定——学生的动作、已揭示的线索、状态阈值等（复用同一套封闭触发词汇）。
    "信息按需具现"：做过那件事、信息才出现，而不是焊死在界面上。
    """

    model_config = ConfigDict(extra="forbid")

    slot: str
    source: Literal["cue", "state", "actor", "affordance"]
    ref: str | None = None
    visible_when: Trigger | None = None


class Nudge(BaseModel):
    model_config = ConfigDict(extra="forbid")

    when: Trigger
    direction: str  # 只给方向，不给条目


class BoardSection(BaseModel):
    """线索板的一个版块（只读投影；学生不能直接编辑）。

    来源是**封闭词汇**：`cue`（已揭示的现场线索）、`state`（读数，随需求出现）、
    `noticed`（你注意到的即兴细节）、`fact`（已确认的事实 + 证据）、`action`（已处置）、
    `note`（DM 写在板上的判断/订正）。
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    title: str
    source: Literal["cue", "state", "noticed", "fact", "action", "note"]
    refs: list[str] = Field(default_factory=list)  # source=state 时指定要显示的键
    labels: dict[str, str] = Field(default_factory=dict)  # 键 → 人话标签（不暴露内部名）
    visible_when: Trigger | None = None

    def label_for(self, ref: str) -> str:
        return self.labels.get(ref) or ref.rsplit(".", maxsplit=1)[-1]


class DeviceChannel(BaseModel):
    """设备上的一个通道（数值或读数）。数值/状态/趋势都由平台从事件流算，不由 LLM 编。"""

    model_config = ConfigDict(extra="forbid")

    ref: str  # 已登记状态键
    label: str
    unit: str = ""
    normal: tuple[float, float] | None = None  # 正常区间
    critical: tuple[float, float] | None = None  # 危急区间（只改视觉与音调，**不是警报**）
    decimals: int = 0
    trend: bool = True  # 是否给趋势（最近若干次取值）
    visible_when: Trigger | None = None  # 通道也按需求出现（例如化验回报要等检查下过）


class Device(BaseModel):
    """**设备面**：场景里的一台设备（监护仪 / 值班电话 / 输液泵…）。

    与白板同级、互补：设备展示**实时读数**，白板展示**已确立的事**。
    通则：**同一读数优先由设备展示，白板自动让位**（不重复出现）。
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    kind: Literal["monitor", "phone", "pump", "other"] = "monitor"
    title: str
    channels: list[DeviceChannel] = Field(default_factory=list)
    sound: Literal["off", "beep"] = "off"  # 默认静音；开启后是**低频提示音**，不是报警
    visible_when: Trigger | None = None


class Presentation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hud: list[HudSlot] = Field(default_factory=list)
    board: list[BoardSection] = Field(default_factory=list)
    devices: list[Device] = Field(default_factory=list)
    nudges: list[Nudge] = Field(default_factory=list)
    panels: list[PanelType] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# 场景单元
# --------------------------------------------------------------------------- #


class ScenarioPack(BaseModel):
    """一份可版本化、可热载、只被解释不被编译的声明。不含分数。"""

    model_config = ConfigDict(extra="forbid")

    pack_schema_version: int = PACK_SCHEMA_VERSION
    key: str
    title: str
    state: PackState = PackState.EXPERIMENTAL
    one_line: str = ""

    player: Player
    setting: Setting
    actors: list[Actor]
    state_keys: dict[str, Any] = Field(default_factory=dict)  # <target>.<key> -> 初值
    # 仅 DM 可见的真相（学生不可见；按钮与展示绝不可泄）
    truth: list[str] = Field(default_factory=list)

    affordances: list[Affordance]
    reactions: list[Reaction] = Field(default_factory=list)

    facts: list[FactSpec] = Field(default_factory=list)
    rubric: list[Criterion] = Field(default_factory=list)  # 每个场景自己写的判据（含权重）
    dims: list[DimSpec] = Field(default_factory=list)

    presentation: Presentation = Field(default_factory=Presentation)

    # 叙事锚点：DM 的任务列表（每回合由事件流重算；不声明 = 该病例不启用编排，一切照旧）
    anchors: list[NarrativeAnchor] = Field(default_factory=list)

    # 场景资源包内可展示的预定义资源（图片）；DM 只能引用这里声明过的 id
    assets: list[Asset] = Field(default_factory=list)
    # 是否允许 DM 请求**绘画者 AI**生成图片（默认关闭：作者显式开启才产生成本）
    image_generation: Literal["disabled", "allowed"] = "disabled"

    failure: Literal["recoverable", "irreversible"] = "recoverable"
    # 不可逆失败的条件（由 pack 声明；无时钟，只看动作与状态）
    failure_when: Trigger | None = None
    # 学生看不到什么（防泄漏 + 真实感）
    hidden_from_player: list[str] = Field(default_factory=list)

    # ---- 便捷索引 ----
    def affordance(self, affordance_id: str) -> Affordance | None:
        return next((a for a in self.affordances if a.id == affordance_id), None)

    def actor(self, actor_id: str) -> Actor | None:
        return next((a for a in self.actors if a.id == actor_id), None)

    def cue(self, cue_id: str) -> Cue | None:
        return next((c for c in self.setting.cues if c.id == cue_id), None)

    def cue_items(self, cue_ids: Iterable[str]) -> list[tuple[str, str]]:
        """(线索 id, 文本) 列表，跳过未知线索。"""
        items: list[tuple[str, str]] = []
        for cue_id in cue_ids:
            cue = self.cue(cue_id)
            if cue is not None:
                items.append((cue_id, cue.text))
        return items

    def content_sha(self) -> str:
        payload = self.model_dump(mode="json", exclude_none=True)
        blob = json.dumps(payload, sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]
