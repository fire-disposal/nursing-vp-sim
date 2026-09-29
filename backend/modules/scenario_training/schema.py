"""情境训练 · 场景单元（ScenarioPack）声明模型与词汇表。

本模块是「情境训练」实验特性的一部分，与 `modules/training/**` 完全隔离：
只允许依赖标准库、三方库、`infra/**`、`modules.auth` 与自身（见 tests/scenario_training）。

**这份声明是材料，不是脚本**（docs/scenario.md）：病例只说清"现场有什么、谁能做什么、
什么算采集到了、什么算做错了"，世界怎么回应由模型在**工具循环**里演绎（`dm/agent.py`）。
因此这里没有反应表、没有教学关注点、没有呈现面板声明——那些是上一代「声明式规则表」的产物。

词汇表：
- **动作类型（封闭 6 种）**：ask / observe / measure / act / document / summon
- **效果操作（封闭 3 种）**：set / incr / decr —— 只能改本 pack 自己登记的状态键
- **触发子句（封闭 4 种）**：只服务 `visible_when` 与 `failure_when` 这几处**确定性门控**
- **决策点规则（封闭 6 种）**：判读挂在规则上，规则可复算
- **设备通道**：数值由平台从事件流算，不由模型编

包只声明**观察**，不含分数。
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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
# 结论：平台适配作者的既有习惯，只在这里做等价归一，不改契约、不让作者迁就枚举。
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
    """触发子句的封闭集合（全部 AND 组合）。

    只保留**确定性门控**真正要用的四种：`visible_when`（动作/设备随需求出现）与
    `failure_when`（不可逆失败条件）。计数型与时间型子句（`action_count_gte` /
    `turns_without_action` / `turn_gte`）只服务已删除的反应表，一并删除：世界的**回应**
    现在由模型演绎，**门控**不该由模型决定——这两件事各有唯一去处。
    """

    ACTION_USED = "action_used"  # 学生用过某 affordance
    CUE_REVEALED = "cue_revealed"  # 某线索已被揭示
    STATE_CMP = "state_cmp"  # 状态键比较（<, <=, ==, >=, >）
    FACT_DECLARED = "fact_declared"  # 某事实已被学生采集到


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


# --------------------------------------------------------------------------- #
# 动作与效果
# --------------------------------------------------------------------------- #


class TargetKind(StrEnum):
    """目标引用的类型（决定平台去哪张声明表校验可达性）。"""

    ACTOR = "actor"
    DEVICE = "device"
    SCENE = "scene"


class TargetRef(BaseModel):
    """类型化目标引用：**永远带 kind**，不靠裸 id 跨命名空间匹配（docs/scenario.md）。

    加载期另外禁止 actor/device/scene 三个命名空间出现重复 id——两层一起兜住类型碰撞。
    """

    model_config = ConfigDict(extra="forbid")

    kind: TargetKind
    id: str


class Effect(BaseModel):
    """动作对处境的确定性影响。`target` 是 actor id 或 `scene`。"""

    model_config = ConfigDict(extra="forbid")

    target: str
    key: str  # 必须是 pack 登记过的状态键（含 <target>.trust 之类的派生键）
    op: EffectOp = EffectOp.SET
    value: Any

    @field_validator("op", mode="before")
    @classmethod
    def _normalize_op(cls, raw: Any) -> Any:
        """容忍作者的自然写法（add/sub/+=/…）。"""
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


class Trigger(BaseModel):
    """触发条件 = 全部子句 AND。空触发视为「永远成立」。"""

    model_config = ConfigDict(extra="forbid")

    all: list[Clause] = Field(default_factory=list)


class Affordance(BaseModel):
    """学生可做的事。类型封闭，参数与文案开放。

    `effects` / `reveals` 是**确定性**的部分：学生点下去就一定发生，不交给模型（判据、回放与
    时间尺都靠它可复算）。模型只负责"世界怎么回应"。
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    type: AffordanceType
    label: str
    params: dict[str, Any] = Field(default_factory=dict)
    visible_when: Trigger | None = None
    # 该动作可作用的目标（`TargetRef`）。非空 = **绑定目标**：
    # 请求的 `target` 必须命中其一，唯一目标时可省略（平台自动绑定），多目标且未给 → 澄清。
    # 空 = 目标不参与结算，只作归属与展示（自由发问、全场级动作）。
    targets: list[TargetRef] = Field(default_factory=list)
    effects: list[Effect] = Field(default_factory=list)
    reveals: list[str] = Field(default_factory=list)
    # **消耗多少情境时间单位**（`turn` = 时间单位累计值，不是请求次数）：
    # 0 = 瞬时（说话/观察/测量——信息获取理所当然，不消耗时间）；正数 = 这次尝试占用的时间。
    # 「刻意等待」也用它表达：作者声明一个 `time_cost > 0` 的动作（例如「等化验回报」「静观十分钟」），
    # 其 reveals/effects 按时间单位结算——不引入定时器、不碰墙钟、不新增动作类型。
    time_cost: int = Field(default=0, ge=0, le=60)
    # 二次确认（危险动作）
    confirm: bool = False
    # 选择形态：none=直接执行；single/multi=需选择 params.options 中的一项或多项
    select: Literal["none", "single", "multi"] = "none"
    # 自输入恒在（平台保证，见 §九）：与 omp 提问工具的 "Other (type your own)" 同构
    # pack/DM **不得**自行提供"其他/自输入"选项；此开关只允许作者显式关闭自输入
    free_input: bool = True


# --------------------------------------------------------------------------- #
# 处境：在场者与场景
# --------------------------------------------------------------------------- #


class Actor(BaseModel):
    """场景里的一个人物。

    `knowledge` 是**信息隔离**的声明：这个人物知道什么。模型可以用 `actor_knows(id)` 查它，
    工具层也据它判断"这句话他有没有资格说"。人物进出本场由模型的 `actor_enter/leave` 表达
    （`presence` 是作者给的上限：`inaccessible` 的人进不了场）。
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    role: str
    presence: Presence = Presence.ON_SITE
    knowledge: dict[str, Any] = Field(default_factory=dict)  # 知道什么 = 防泄漏边界
    style: str = ""
    goals: list[str] = Field(default_factory=list)
    demand: Demand = Demand.NEUTRAL


class Cue(BaseModel):
    """可见线索。由**动作的 `reveals`**或模型的 `cue_reveal` 揭示——线索本身不声明来源。"""

    model_config = ConfigDict(extra="forbid")

    id: str
    text: str
    visible_from_start: bool = False


class Asset(BaseModel):
    """场景资源包内的预定义资源（由**场景准备者**预先准备，按需展示）。

    `reveal_with`（可选，any-of）：声明了它，就必须等其中**至少一条线索被揭示**之后才允许
    `present_image`。提前发 → 拒绝这一次调用并记账（拒绝计数进事件载荷），**不整条回合判死**。
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    kind: Literal["image"] = "image"
    path: str = ""  # 仓库播种来源：assets/<pack_key>/<path>（可留空，由管理侧上传字节）
    title: str = ""
    alt: str = ""  # 无障碍与"看不到图也能用"
    reveal_with: list[str] = Field(default_factory=list)


class Setting(BaseModel):
    model_config = ConfigDict(extra="forbid")

    place: str
    time_hint: str = ""
    cues: list[Cue] = Field(default_factory=list)
    resources: list[str] = Field(default_factory=list)


class Player(BaseModel):
    """学生也是场景中的角色（只有"你是谁"这一件事；能做什么由 `affordances` 声明）。"""

    model_config = ConfigDict(extra="forbid")

    role: str


# --------------------------------------------------------------------------- #
# 判读：只声明观察
# --------------------------------------------------------------------------- #


class FactSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    intent: str  # 意图描述（**不得出现在按钮文案里**）
    kind: FactKind = FactKind.REPORTED
    critical: bool = False
    # 作者显式声明的禁用词：按钮/选项文案中出现即视为泄底
    banned_phrases: list[str] = Field(default_factory=list)
    # 该事实"被采集到"的可观测判据（判读只读世界事实，不读模型的自述）：
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
    title: str  # 一句话说清这条在评什么（进报告，不进模型提示词）
    rule: JudgeRuleKind
    params: dict[str, Any] = Field(default_factory=dict)
    anchors: dict[Anchor, str]
    weight: int = Field(default=1, ge=1, le=100)  # 正整数 1–100；平台侧用，LLM 看不见
    score_map: dict[Anchor, float] = Field(
        default_factory=lambda: {Anchor.STRONG: 1.0, Anchor.ADEQUATE: 0.5, Anchor.MISSED: 0.0}
    )


class StateBound(BaseModel):
    """数值状态键的**写边界**：模型的 `world_set` 超出即拒（`out_of_range`）。

    只有作者声明了边界的键才有上限/下限；没声明就只能被类型校验拦住。
    """

    model_config = ConfigDict(extra="forbid")

    lo: float | None = None
    hi: float | None = None


# --------------------------------------------------------------------------- #
# 呈现：设备
# --------------------------------------------------------------------------- #


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

    读数只在这里展示（"读数归设备面板"）：凡是要让学生看见的数值，作者都必须声明成设备通道，
    否则它只存在于引擎内部。设备/通道的 `visible_when` 是**确定性门控**；模型另外可以用
    `present_monitor(device_id)` 把一台设备主动摆到学生面前（两者取并集）。
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

    devices: list[Device] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# 场景单元
# --------------------------------------------------------------------------- #


class ScenarioPack(BaseModel):
    """一份病例：**当前内容**（没有形状版本、没有修订号）。"""

    model_config = ConfigDict(extra="forbid")

    key: str
    title: str
    one_line: str = ""

    player: Player
    setting: Setting
    actors: list[Actor]
    state_keys: dict[str, Any] = Field(default_factory=dict)  # <target>.<key> -> 初值
    # 数值键的写边界（模型 `world_set` 用）；布尔/字符串键只做类型校验
    state_bounds: dict[str, StateBound] = Field(default_factory=dict)
    # 现场真相（学生不可见；模型演绎世界时要有一份自洽的事实）
    truth: list[str] = Field(default_factory=list)

    affordances: list[Affordance]

    facts: list[FactSpec] = Field(default_factory=list)
    rubric: list[Criterion] = Field(default_factory=list)  # 每个场景自己写的判据（含权重）

    presentation: Presentation = Field(default_factory=Presentation)

    # 场景资源包内可展示的预定义资源（图片）；只有这里声明过的 id 能被 `present_image` 展示
    assets: list[Asset] = Field(default_factory=list)

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

    def device(self, device_id: str) -> Device | None:
        return next((d for d in self.presentation.devices if d.id == device_id), None)

    def cue(self, cue_id: str) -> Cue | None:
        return next((c for c in self.setting.cues if c.id == cue_id), None)

    def asset(self, asset_id: str) -> Asset | None:
        return next((a for a in self.assets if a.id == asset_id), None)

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
