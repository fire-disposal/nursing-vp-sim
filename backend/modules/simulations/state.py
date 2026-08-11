"""Session state dataclasses for the clinical reasoning simulation.

These are pure runtime values held inside a single JSONB column. The ORM
table lives in ``models/simulation.py``; this module is the in-memory shape
the engine operates on (and serializes to/from for persistence).
"""

from dataclasses import asdict, dataclass, field


@dataclass
class HiddenClinicalState:
    bleeding_severity: float
    reported_to_doctor: bool
    monitoring_enabled: bool


@dataclass
class VitalsReading:
    minute: int
    hr: int
    sbp: int
    dbp: int
    rr: int
    spo2: int
    temp: float
    abnormal: bool


@dataclass
class DrainReading:
    minute: int
    output_ml: int
    abnormal: bool


@dataclass
class ClinicalRecord:
    order_id: str
    kind: str
    sampled_at: int
    ready_at: int
    result: dict
    revealed: bool


@dataclass
class PendingTask:
    id: str
    kind: str
    status: str
    ordered_at: int
    sampled_at: int
    due_at: int
    sample_snapshot: dict
    cost_yuan: int


@dataclass(order=True)
class ScheduledEvent:
    at_minute: int
    priority: int
    sequence: int
    id: str
    type: str
    payload: dict = field(default_factory=dict)


@dataclass
class DomainMessage:
    kind: str
    at_minute: int
    text: str


@dataclass
class ActionRecord:
    started_at: int
    completed_at: int
    action_type: str
    action_target: str | None
    outcome: str


@dataclass
class SessionState:
    hidden: HiddenClinicalState
    current_time: int
    case_status: str  # ACTIVE | SUCCESS | FAILURE
    records: list[ClinicalRecord] = field(default_factory=list)
    pending_tasks: list[PendingTask] = field(default_factory=list)
    events: list[ScheduledEvent] = field(default_factory=list)
    action_log: list[ActionRecord] = field(default_factory=list)
    public_log: list[DomainMessage] = field(default_factory=list)
    vitals: list[VitalsReading] = field(default_factory=list)
    drain: list[DrainReading] = field(default_factory=list)
    monitor_alert_fired: bool = False
    deteriorated: bool = False
    seq: int = 0
    cbc_count: int = 0
    cost_total: int = 0
    repeat_while_pending: bool = False
    case_ended_at: int | None = None
    revision: int = 0


def state_to_dict(s: SessionState) -> dict:
    return asdict(s)


def state_from_dict(raw: dict) -> SessionState:
    hidden = raw["hidden"]
    state = SessionState(
        hidden=HiddenClinicalState(
            bleeding_severity=hidden["bleeding_severity"],
            reported_to_doctor=hidden["reported_to_doctor"],
            monitoring_enabled=hidden["monitoring_enabled"],
        ),
        current_time=raw["current_time"],
        case_status=raw["case_status"],
        monitor_alert_fired=raw.get("monitor_alert_fired", False),
        deteriorated=raw.get("deteriorated", False),
        seq=raw.get("seq", 0),
        cbc_count=raw.get("cbc_count", 0),
        cost_total=raw.get("cost_total", 0),
        repeat_while_pending=raw.get("repeat_while_pending", False),
        case_ended_at=raw.get("case_ended_at"),
        revision=raw.get("revision", 0),
    )
    state.records = [ClinicalRecord(**r) for r in raw.get("records", [])]
    state.pending_tasks = [PendingTask(**p) for p in raw.get("pending_tasks", [])]
    state.events = [ScheduledEvent(**e) for e in raw.get("events", [])]
    state.action_log = [ActionRecord(**a) for a in raw.get("action_log", [])]
    state.public_log = [DomainMessage(**m) for m in raw.get("public_log", [])]
    state.vitals = [VitalsReading(**v) for v in raw.get("vitals", [])]
    state.drain = [DrainReading(**d) for d in raw.get("drain", [])]
    return state
