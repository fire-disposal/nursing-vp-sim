"""Pydantic contracts for the clinical reasoning simulation API."""

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG


class SimulationActionIn(BaseModel):
    model_config = _REQ_CFG
    type: str = Field(min_length=1, max_length=32)
    target: str | None = None


class SimulationActionRequest(BaseModel):
    model_config = _REQ_CFG
    action: SimulationActionIn


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


class PendingCbcSummary(BaseModel):
    id: str
    sampled_at: int
    due_at: int
    due_clock: str


class CbcRecordSummary(BaseModel):
    order_id: str
    sampled_at: int
    ready_at: int
    hb: float
    wbc: float
    platelet: int
    abnormal: bool


class SimulationSnapshot(BaseModel):
    model_config = _RESP_CFG
    session_id: int
    revision: int
    case_status: str
    current_time: int
    clock: str
    monitoring: bool
    reported: bool
    messages: list[SimulationMessage] = []
    vitals: list[VitalsReadingOut] = []
    drain: list[DrainReadingOut] = []
    pending_cbc: PendingCbcSummary | None = None
    cbc_records: list[CbcRecordSummary] = []
    unrevealed_cbc_count: int = 0
    cbc_count: int = 0
    cost_total: int = 0
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
