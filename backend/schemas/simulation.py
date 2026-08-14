"""Pydantic contracts for the clinical reasoning simulation API."""

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG


class SimulationActionIn(BaseModel):
    model_config = _REQ_CFG
    type: str = Field(min_length=1, max_length=32)
    target: str | None = None
    text: str | None = Field(default=None, max_length=500)


class SimulationActionRequest(BaseModel):
    model_config = _REQ_CFG
    action: SimulationActionIn


class SessionCreateRequest(BaseModel):
    model_config = _REQ_CFG
    case_id: str | None = None


class CaseMeta(BaseModel):
    id: str
    name: str
    version: str
    start_clock: str = "08:30"  # 分片化：病例起始时钟，前端据此渲染消息/时间轴墙钟


class SimulationMessage(BaseModel):
    kind: str
    at_minute: int
    text: str


class VitalsReadingOut(BaseModel):
    minute: int
    hr: int
    sbp: int
    dbp: int
    rr: int
    spo2: int
    temp: float
    abnormal: bool


class DrainReadingOut(BaseModel):
    minute: int
    output_ml: int
    abnormal: bool


class PainReadingOut(BaseModel):
    minute: int
    score: int
    abnormal: bool


class UrineReadingOut(BaseModel):
    minute: int
    output_ml: int
    abnormal: bool


class CommandSurfaceOut(BaseModel):
    """The case-declared command surface — what the player may do here.

    The frontend builds its command palette from this, so a new specialty
    case's commands are rendered automatically without frontend edits.
    """

    assessments: dict[str, str] = {}
    drugs: dict[str, str] = {}
    labs: dict[str, str] = {}
    talk_roles: list[str] = []
    wait_labs: bool = True
    monitor: bool = True


class PendingLabSummary(BaseModel):
    id: str
    kind: str
    label: str
    sampled_at: int
    due_at: int
    due_clock: str


class LabRecordSummary(BaseModel):
    order_id: str
    kind: str
    label: str
    sampled_at: int
    ready_at: int
    result: dict
    abnormal: bool


class ActionEntry(BaseModel):
    """One actionable item — the server-driven button contract.

    The frontend renders every action from this; ``enabled`` /
    ``disabled_reason`` are computed by the engine, so a disabled button
    always explains itself and the UI never re-implements a rule.
    """

    id: str
    label: str
    cost: int | None = None
    cost_label: str | None = None
    duration: int | None = None
    turnaround: int | None = None
    unit: str | None = None
    default_dose: float | None = None
    max_dose: float | None = None
    enabled: bool = True
    disabled_reason: str | None = None


class ActionCatalogOut(BaseModel):
    assess: list[ActionEntry] = []
    order: list[ActionEntry] = []
    give: list[ActionEntry] = []
    talk: list[ActionEntry] = []
    manage: list[ActionEntry] = []


class CaseBriefOut(BaseModel):
    """开局简报 — CaseSpec 派生的结构化开局信息，前端渲染简报卡。"""

    patient: str
    task: str
    goal: str
    resources: dict[str, int] = {}
    assessments: list[str] = []
    drugs: list[str] = []
    labs: list[str] = []
    talk_roles: list[str] = []
    opening_hint: str = ""


class ObjectivesOut(BaseModel):
    """目标清单 — 病例目标的实时达成情况（纯函数计算，不泄露 hidden）。"""

    assessed: bool = False
    evidence: bool = False
    monitoring: bool = False
    treated: bool = False
    reported: bool = False
    diagnosis: bool = False
    timely: str | None = None  # "timely" | "delayed" | None


class HintOut(BaseModel):
    level: int
    text: str


class PatientStateOut(BaseModel):
    """床旁患者状态 — 只含玩家已知信息（意识档位/监护/最近生命体征）。"""

    consciousness: str = "alert"  # alert / lethargic / comatose
    consciousness_label: str = "清醒"
    monitoring: bool = False
    latest_vitals: dict | None = None


class SimulationSnapshot(BaseModel):
    model_config = _RESP_CFG
    session_id: int
    revision: int
    case_status: str
    case_meta: CaseMeta
    cases: list[CaseMeta] = []  # 全部可选病例（含当前），前端据此渲染病例切换入口
    surface: CommandSurfaceOut
    current_time: int
    clock: str
    monitoring: bool
    reported: bool
    diagnosis: str | None = None
    messages: list[SimulationMessage] = []
    vitals: list[VitalsReadingOut] = []
    drain: list[DrainReadingOut] = []
    pain: list[PainReadingOut] = []
    urine: list[UrineReadingOut] = []
    readings: dict[str, list[dict]] = {}
    pending: list[PendingLabSummary] = []
    lab_records: list[LabRecordSummary] = []
    unrevealed_lab_count: int = 0
    cbc_count: int = 0
    diag_spent: int = 0
    diag_budget: int = 0
    treat_spent: int = 0
    treat_budget: int = 0
    case_ended_at: int | None = None
    # 新一代交互契约：行动目录（服务器驱动按钮）/ 开局简报 / 目标清单 / 教练提示 / 床旁状态。
    actions: ActionCatalogOut = Field(default_factory=ActionCatalogOut)
    brief: CaseBriefOut = Field(default_factory=CaseBriefOut)
    objectives: ObjectivesOut = Field(default_factory=ObjectivesOut)
    hint: HintOut | None = None
    patient: PatientStateOut = Field(default_factory=PatientStateOut)


class SessionCreateResponse(BaseModel):
    session_id: int
    snapshot: SimulationSnapshot


class ActionResultResponse(BaseModel):
    session_id: int
    revision: int
    accepted: bool
    case_ended: bool
    messages: list[SimulationMessage] = []
    snapshot: SimulationSnapshot
