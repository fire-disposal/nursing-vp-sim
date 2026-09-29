"""情境训练 · **对外**响应/请求模型（唯一来源：JSON schema 与前端类型都由它生成）。

规矩（docs/23 §8.1）：
- 学生只收**可见投影**；拒绝原因、隐藏依据、教学关注点只在管理侧模型里出现。
- 内部结算模型（`turns.ResolvedTurn` 等）**不是**对外返回模型：学生拿 `ScenarioView`，
  教师回放拿 `ScenarioAdminTurnReplay`。
- 类型从这些模型生成（`pnpm run api:update`），**禁止手改** `api-types.gen.ts`。

命名：对外模型一律 `Scenario*` 前缀（前端既有别名可逐一对上）；纯词汇表（`TargetRef`、
`IntentResolution`、`ResolvedTurn`、`SceneDelivery`…）留在 `turns.py`，生成名就是它本身。
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from .schema import Anchor, PackState
from .turns import (
    AttemptOutcome,
    DeclarationKind,
    MessageKind,
    MessageOrigin,
    MessageRole,
    ModelsUsed,
    ResolvedTurn,
    SceneDelivery,
    TargetRef,
    TurnInput,
    TurnPhase,
)

# --------------------------------------------------------------------------- #
# 请求
# --------------------------------------------------------------------------- #


class ScenarioOpenSessionRequest(BaseModel):
    pack_key: str | None = None
    revision_id: int | None = None  # trial=true 时必填（固定刚保存的修订）
    trial: bool = False  # 试跑：需 `case_manage`；会话显式标记并从统计默认排除


class ScenarioTurnRequest(BaseModel):
    """学生的一次请求。`expected_seq` / `request_id` 的仲裁见 docs/23 §4.5。

    `text` 是学生**打的字**：自由表达、要尝试的行动、document 动作的记录内容（**纯文本，不是 JSON**）。
    `selection` 只放声明过的选项 id（「其他」之类自写内容进 `text`）。
    """

    request_id: str = Field(min_length=1, max_length=64)
    expected_seq: int = Field(ge=0)
    kind: Literal["speech", "action", "hint"]
    target: TargetRef | None = None
    affordance_id: str | None = None
    selection: list[str] = Field(default_factory=list)
    text: str | None = Field(default=None, max_length=2000)


class ScenarioCloseRequest(BaseModel):
    request_id: str = Field(min_length=1, max_length=64)
    expected_seq: int = Field(ge=0)


# --------------------------------------------------------------------------- #
# 学生侧：视图
# --------------------------------------------------------------------------- #


class ScenarioPackSummary(BaseModel):
    key: str
    title: str
    state: str
    one_line: str
    revision_id: int | None = None
    revision_no: int | None = None
    player_role: str = ""
    place: str = ""


class ScenarioMessage(BaseModel):
    """对话流里的一条。`id` 是**稳定显示身份**（接续与去重按它，不按文案）。"""

    id: str
    role: MessageRole
    kind: MessageKind
    text: str
    turn: int  # 所属**时间单位**：同一时间单位里可以有多条消息（交流不消耗时间）
    target: TargetRef | None = None
    declaration: DeclarationKind | None = None
    actor: str | None = None
    actor_role: str | None = None
    ephemeral: bool = False
    avatar_seed: str | None = None
    origin: MessageOrigin = "dm"
    sources: list[str] = Field(default_factory=list)


class ScenarioSituation(BaseModel):
    place: str = ""
    time_hint: str = ""
    resources: list[str] = Field(default_factory=list)
    visible_cues: list[str] = Field(default_factory=list)
    noticed: list[str] = Field(default_factory=list)


class ScenarioActor(BaseModel):
    id: str
    role: str
    presence: str
    present: bool
    contactable: bool = True  # presence != inaccessible：可见可辨，但不可搭话/不可作用


class ScenarioAffordanceOption(BaseModel):
    """选择型动作的一个可选项：**id 进 `selection`，label 只用于显示**。"""

    id: str
    label: str = ""


class ScenarioAffordance(BaseModel):
    id: str
    type: str
    label: str
    select: str = "none"
    options: list[ScenarioAffordanceOption] = Field(default_factory=list)
    fields: list[str] = Field(default_factory=list)
    free_input: bool = True
    confirm: bool = False
    targets: list[TargetRef] = Field(default_factory=list)
    #: 包声明的**情境时间单位**消耗（0 = 瞬时）。学生端只据此显示「耗时」标记，**不显示数字**：
    #: 时间会改变反应与后果，学生必须看得出哪些动作要花时间；但抽象单位数不该摆在脸上。
    time_cost: int = 0


class ScenarioHudSlot(BaseModel):
    slot: str
    source: str
    label: str | None = None
    value: Any = None
    ref: str | None = None
    items: list[str] | None = None
    count: int | None = None


class ScenarioTimelineEntry(BaseModel):
    turn: int
    kind: Literal["student", "world"]
    label: str
    by: str | None = None


class ScenarioDim(BaseModel):
    id: str
    label: str
    agg: str
    value: float | None = None
    unit: str = ""
    detail: str = ""


class ScenarioAsset(BaseModel):
    id: str
    title: str = ""
    alt: str = ""
    suggest_when: str = ""
    url: str | None = None


class ScenarioImage(BaseModel):
    asset_id: str
    url: str | None = None
    title: str = ""
    alt: str = ""
    caption: str = ""
    origin: str = "pack"


class ScenarioBoardEntry(BaseModel):
    id: str
    kind: Literal["cue", "state", "noticed", "fact", "action"]
    text: str
    source: Literal["pack", "world"]
    ref: str | None = None
    value: Any = None
    count: int | None = None
    turn: int | None = None
    evidence: str | None = None


class ScenarioBoardSection(BaseModel):
    id: str
    title: str
    source: Literal["cue", "state", "noticed", "fact", "action"]
    entries: list[ScenarioBoardEntry] = Field(default_factory=list)
    more: int = 0


class ScenarioBoard(BaseModel):
    sections: list[ScenarioBoardSection] = Field(default_factory=list)
    entry_count: int = 0
    editable: bool = False


class ScenarioDeviceChannel(BaseModel):
    ref: str
    label: str
    unit: str = ""
    display: str
    value: Any = None
    status: Literal["normal", "low", "high", "critical", "unknown"] = "unknown"
    delta: float | None = None
    history: list[float] = Field(default_factory=list)
    normal: list[float] | None = None
    critical: list[float] | None = None
    measured: bool = False  # 本场是否**实际产生过**该读数（未测量不得用 0 代替）
    updated_turn: int | None = None  # 最近一次变化发生在哪一回合（不是真实分钟）


class ScenarioDevice(BaseModel):
    id: str
    kind: str
    title: str
    sound: Literal["off", "beep"] = "off"
    channels: list[ScenarioDeviceChannel] = Field(default_factory=list)


class ScenarioViewSession(BaseModel):
    id: int
    status: str
    turn: int
    lost: bool = False
    seq: int = 0  # 已提交事件的最大序号 —— `expected_seq` 的唯一来源
    read_only: bool = False
    trial: bool = False


class ScenarioViewPack(BaseModel):
    key: str
    title: str
    player_role: str = ""
    revision_id: int | None = None


class ScenarioView(BaseModel):
    """学生可见的完整投影。**不含** problems / 教学关注点 / 隐藏事实 / 拒绝判定。"""

    session: ScenarioViewSession
    pack: ScenarioViewPack
    situation: ScenarioSituation
    actors: list[ScenarioActor] = Field(default_factory=list)
    hud: list[ScenarioHudSlot] = Field(default_factory=list)
    messages: list[ScenarioMessage] = Field(default_factory=list)
    affordances: list[ScenarioAffordance] = Field(default_factory=list)
    free_input: bool = True
    timeline: list[ScenarioTimelineEntry] = Field(default_factory=list)
    dims: list[ScenarioDim] = Field(default_factory=list)
    nudges: list[str] = Field(default_factory=list)
    assets: list[ScenarioAsset] = Field(default_factory=list)
    images: list[ScenarioImage] = Field(default_factory=list)
    board: ScenarioBoard = Field(default_factory=ScenarioBoard)
    devices: list[ScenarioDevice] = Field(default_factory=list)
    panels: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# 学生侧：回合结果与查询
# --------------------------------------------------------------------------- #


class ScenarioErrorInfo(BaseModel):
    """学生侧错误：**只有** code 与 message（不出现 problems、字段路径、堆栈）。"""

    code: str
    message: str
    retryable: bool = False
    current_seq: int | None = None  # 仅 session_conflict


class ScenarioTurnResult(BaseModel):
    request_id: str
    seq: int  # 每个已提交请求 +1：顺序与 `expected_seq` 的基线（与时间步不是一个概念）
    committed: bool = True
    turn: int  # 发生时的**情境时间单位累计值**（说话/观察不增加它）
    time_cost: int = 0  # 本回合消耗的时间单位（0 = 瞬时；只有包声明 time_cost 的动作会花时间）
    outcome: AttemptOutcome
    block_reason: str | None = None
    messages: list[ScenarioMessage] = Field(default_factory=list)
    view: ScenarioView


class ScenarioSessionResponse(BaseModel):
    session_id: int
    pack: ScenarioViewPack
    view: ScenarioView


class ScenarioArchiveRef(BaseModel):
    archived_at: str | None = None
    shape_version: int = 1
    ended_reason: str = ""


class ScenarioSessionState(BaseModel):
    session_id: int
    status: str
    report: ScenarioReport | None = None
    legacy_report: dict[str, Any] | None = None
    """旧机制原样留档的报告（**不重算、不改写**）：有它说明这份会话是切换前的。"""
    view: ScenarioView
    read_only: bool = False
    archive: ScenarioArchiveRef | None = None


class ScenarioSessionRow(BaseModel):
    id: int
    user_id: int
    pack_key: str
    pack_title: str
    pack_revision_id: int
    status: str
    turn: int | None = None
    lost: bool | None = None
    summary: dict[str, int] | None = None
    read_only: bool = False
    trial: bool = False
    created_at: str | None = None
    updated_at: str | None = None


class ScenarioKeyTurn(BaseModel):
    """复盘页的关键回合：你做了什么、当时有什么证据、发生了哪些已记录的变化。"""

    turn: int
    student: str
    evidence: list[str] = Field(default_factory=list)
    changes: list[str] = Field(default_factory=list)


class ScenarioOutcome(BaseModel):
    status: Literal["lost", "ended_by_student", "cutover"]
    reason: str = ""
    turn: int
    lost: bool = False


class ScenarioCriterion(BaseModel):
    id: str
    title: str
    anchor: Anchor
    score: float
    weight: float
    detail: str = ""
    evidence: list[str] = Field(default_factory=list)


class ScenarioScore(BaseModel):
    rate: float | None = None
    weighted_sum: float = 0.0
    total_weight: float = 0.0
    criteria: list[ScenarioCriterion] = Field(default_factory=list)


class ScenarioAssessment(BaseModel):
    """判读与分数：**次级区域**，明确是场景规则反馈，不冒充能力判定。"""

    summary: dict[str, int] = Field(default_factory=dict)
    score: ScenarioScore
    criteria: list[ScenarioCriterion] = Field(default_factory=list)
    dims: list[ScenarioDim] = Field(default_factory=list)


class ScenarioReport(BaseModel):
    pack: ScenarioViewPack
    outcome: ScenarioOutcome
    key_turns: list[ScenarioKeyTurn] = Field(default_factory=list)
    reflection: str | None = None
    assessment: ScenarioAssessment
    timeline: list[ScenarioTimelineEntry] = Field(default_factory=list)


class ScenarioCloseResponse(BaseModel):
    session_id: int
    report: ScenarioReport
    view: ScenarioView


class ScenarioRequestLookup(BaseModel):
    """按 `request_id` 取回原结果（断流恢复的唯一入口）。

    `kind` 说明这个 request_id 是哪类请求：`turn` → 看 `result`，`close` → 看 `close_result`。
    """

    request_id: str
    kind: Literal["turn", "close"] = "turn"
    state: Literal["committed", "in_flight", "failed", "unknown"]
    resend_safe: bool = True  # 除 committed 外恒 true：同 id 重发安全（提交时只会成功一次）
    seq: int | None = None
    turn: int | None = None
    outcome: AttemptOutcome | None = None
    result: ScenarioTurnResult | None = None
    close_result: ScenarioCloseResponse | None = None
    error: ScenarioErrorInfo | None = None


# --------------------------------------------------------------------------- #
# 管理侧：内容
# --------------------------------------------------------------------------- #


class ScenarioAdminActor(BaseModel):
    id: str
    role: str
    presence: str


class ScenarioAdminFocusSummary(BaseModel):
    id: str
    intent: str


class ScenarioAdminOverview(BaseModel):
    player_role: str
    place: str
    time_hint: str = ""
    resources: list[str] = Field(default_factory=list)
    actors: list[ScenarioAdminActor] = Field(default_factory=list)
    teaching_focus: list[ScenarioAdminFocusSummary] = Field(default_factory=list)
    cues: int = 0
    affordances: int = 0
    reactions: int = 0
    facts: int = 0
    criteria: int = 0
    criteria_weight: int = 0
    failure: str = "recoverable"
    image_generation: str = "disabled"


class ScenarioAdminRevision(BaseModel):
    id: int
    no: int
    note: str = ""


class ScenarioAdminAsset(BaseModel):
    id: str
    kind: str = "image"
    title: str = ""
    alt: str = ""
    suggest_when: str = ""
    filename: str = ""
    mime_type: str = ""
    file_size: int = 0
    uploaded: bool = False


class ScenarioAdminAssetUpload(BaseModel):
    """上传一张场景图片的结果（上传即追加一个新修订）。"""

    key: str
    revision_no: int
    asset: ScenarioAdminAsset


class ScenarioAdminPack(BaseModel):
    key: str
    title: str
    state: str
    one_line: str = ""
    revision_id: int | None = None
    revision_no: int | None = None
    revisions: list[ScenarioAdminRevision] = Field(default_factory=list)
    assets: list[ScenarioAdminAsset] = Field(default_factory=list)
    overview: ScenarioAdminOverview | None = None
    sessions: int = 0


class ScenarioAdminPackUpload(BaseModel):
    key: str
    revision_id: int
    revision_no: int
    created: bool
    assets_pending: list[str] = Field(default_factory=list)  # 仓库里缺文件、只有声明的资源 id


class ScenarioPackProblem(BaseModel):
    path: str = ""
    message: str


class ScenarioPackValidation(BaseModel):
    ok: bool
    problems: list[ScenarioPackProblem] = Field(default_factory=list)
    content_sha: str | None = None
    latest_sha: str | None = None
    will_append: bool = False
    next_revision_no: int | None = None
    pack_schema_version: int = 0


class ScenarioAdminPackSource(BaseModel):
    key: str
    title: str
    state: str
    revision_id: int
    revision_no: int
    note: str = ""
    content: dict[str, Any] = Field(default_factory=dict)
    problems: list[ScenarioPackProblem] = Field(default_factory=list)
    revisions: list[ScenarioAdminRevision] = Field(default_factory=list)
    schema_version: int = 0
    current_schema_version: int = 0
    compatible: bool = True  # false = 历史形状：显示原始 JSON，编辑需走显式转换
    legacy: bool = False


class ScenarioAdminPackConvert(BaseModel):
    """旧修订 → 当前形状草稿的**显式**转换结果（不静默裁剪、不宣称语义兼容）。"""

    content: dict[str, Any] = Field(default_factory=dict)
    notes: list[str] = Field(default_factory=list)
    problems: list[ScenarioPackProblem] = Field(default_factory=list)
    from_schema_version: int = 0
    to_schema_version: int = 0


class ScenarioPackContentRequest(BaseModel):
    """编辑器提交的完整 pack 内容（原始 dict；形状由**加载期同一套校验**负责）。"""

    content: dict[str, Any] = Field(default_factory=dict)
    note: str = Field(default="", max_length=200)


class ScenarioPackConvertRequest(BaseModel):
    """把**某个历史修订**转成当前形状草稿：只认 `revision_id`（服务端读那一版内容转换）。

    没有"直接 POST content"这条入口——转换的输入必须是**库里真实存在的那一版**，
    否则编辑器会拿到一份与任何修订都不对应的退化草稿（前端 helper 一直只发 `revision_id`）。
    """

    revision_id: int = Field(..., ge=1)


class ScenarioPackPatchRequest(BaseModel):
    state: PackState | None = None
    title: str | None = Field(default=None, max_length=200)
    one_line: str | None = Field(default=None, max_length=400)


# --------------------------------------------------------------------------- #
# 管理侧：回放
# --------------------------------------------------------------------------- #


class ScenarioAdminFocusState(BaseModel):
    id: str
    intent: str = ""
    relevant: bool = False
    addressed: bool = False
    evidence_refs: list[str] = Field(default_factory=list)


class ScenarioAdminFocusTurn(BaseModel):
    turn: int
    states: list[ScenarioAdminFocusState] = Field(default_factory=list)


class ScenarioAdminTurnReplay(BaseModel):
    """一个已提交回合的「解析 → 结算 → 交付」来源回放（**不是**模型的思考过程）。"""

    seq: int
    turn: int
    request_id: str = ""
    kind: str = ""
    input: TurnInput
    intent: dict[str, Any] | None = None
    resolved: ResolvedTurn | None = None
    delivery: SceneDelivery | None = None
    outcome: str = ""
    block_reason: str | None = None
    problems: list[str] = Field(default_factory=list)
    models: ModelsUsed = Field(default_factory=ModelsUsed)


class ScenarioAdminEvent(BaseModel):
    kind: str
    payload: dict[str, Any] = Field(default_factory=dict)


class ScenarioAdminSessionRow(ScenarioSessionRow):
    pass


class ScenarioAdminSessionList(BaseModel):
    total: int
    items: list[ScenarioAdminSessionRow] = Field(default_factory=list)


class ScenarioAdminSessionDetail(BaseModel):
    session: ScenarioAdminSessionRow
    view: ScenarioView
    report: ScenarioReport | None = None
    archived: bool = False
    problems: list[str] = Field(default_factory=list)
    focus: list[ScenarioAdminFocusTurn] = Field(default_factory=list)
    turns: list[ScenarioAdminTurnReplay] = Field(default_factory=list)
    event_count: int = 0
    events: list[ScenarioAdminEvent] = Field(default_factory=list)


class ScenarioAdminStatsBucket(BaseModel):
    pack_key: str
    pack_title: str
    sessions: int = 0
    completed: int = 0
    lost: int = 0
    focus_address_ratio: float | None = None  # 已处理关注点 / 相关关注点（无关注点 = null）


class ScenarioAdminStats(BaseModel):
    packs: list[ScenarioAdminStatsBucket] = Field(default_factory=list)


class ScenarioGeneratedAsset(BaseModel):
    id: int
    session_id: int
    pack_key: str
    pack_revision_id: int
    kind: str = "image"
    prompt: str = ""
    mime_type: str = ""
    file_size: int = 0
    sha256: str = ""
    created_at: str | None = None


class ScenarioGeneratedList(BaseModel):
    items: list[ScenarioGeneratedAsset] = Field(default_factory=list)
    total: int = 0


# --------------------------------------------------------------------------- #
# 管理侧：归档（历史只读）
# --------------------------------------------------------------------------- #


class ScenarioArchiveSummary(BaseModel):
    session_id: int
    pack_key: str
    pack_revision_id: int
    shape_version: int = 1
    archived_at: str | None = None
    status: str = "completed"
    turn: int = 0
    ended_reason: str = ""
    has_report: bool = False


class ScenarioArchiveList(BaseModel):
    total: int
    items: list[ScenarioArchiveSummary] = Field(default_factory=list)


class ScenarioArchiveRaw(BaseModel):
    events: list[ScenarioAdminEvent] = Field(default_factory=list)
    pack_revision: dict[str, Any] = Field(default_factory=dict)


class ScenarioArchiveDetail(BaseModel):
    summary: ScenarioArchiveSummary
    view: ScenarioView
    report: ScenarioReport | None = None
    legacy_report: dict[str, Any] | None = None
    """旧机制原样留档的报告（§9.1：报告原来不存在就留空，绝不补生成）。"""
    focus: list[ScenarioAdminFocusTurn] = Field(default_factory=list)
    turns: list[ScenarioAdminTurnReplay] = Field(default_factory=list)
    raw: ScenarioArchiveRaw = Field(default_factory=ScenarioArchiveRaw)


# --------------------------------------------------------------------------- #
# SSE 载荷（四种事件的 `data`）
# --------------------------------------------------------------------------- #


class ScenarioSsePhase(BaseModel):
    request_id: str
    phase: TurnPhase


class ScenarioSseDelivery(BaseModel):
    request_id: str
    pending: bool = True
    delivery: SceneDelivery


class ScenarioSseCommitted(BaseModel):
    request_id: str
    seq: int
    result: ScenarioTurnResult


class ScenarioSseError(BaseModel):
    request_id: str
    phase: str = ""
    error: ScenarioErrorInfo


#: SSE 四种事件的负荷联合（只用于**生成类型与文档**；运行期是 `text/event-stream` 分帧）。
ScenarioSseEnvelope = ScenarioSsePhase | ScenarioSseDelivery | ScenarioSseCommitted | ScenarioSseError
