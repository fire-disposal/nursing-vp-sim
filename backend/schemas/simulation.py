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
