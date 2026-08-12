"""Session state dataclasses for the clinical reasoning simulation.

These are pure runtime values held inside a single JSONB column. The ORM
table lives in ``models/simulation.py``; this module is the in-memory shape
the engine operates on (and serializes to/from for persistence).
"""

from dataclasses import asdict, dataclass, field


@dataclass
class HiddenClinicalState:
    """Hidden disease axes plus the compartment physiology state.

    ``values`` is a dict so a case can carry multiple physiological axes
    (e.g. ``{"bleeding": 0.12}``, optionally ``infection``). ``physio`` holds
    the compartment state (vol/svr/lactate/hb) advanced by the per-case
    physiology engine at each disease tick; both stay server-side only.
    """

    values: dict[str, float]
    physio: dict[str, float]
    reported_to_doctor: bool
    monitoring_enabled: bool


@dataclass
class Reading:
    """Base for every clinical observation: when it was taken and whether it
    flagged abnormal. Subclasses add the specific measured fields."""

    minute: int
    abnormal: bool


@dataclass
class VitalsReading(Reading):
    hr: int
    sbp: int
    dbp: int
    rr: int
    spo2: int
    temp: float


@dataclass
class DrainReading(Reading):
    output_ml: int


@dataclass
class PainReading(Reading):
    score: int


@dataclass
class UrineReading(Reading):
    output_ml: int


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
    case_id: str = "mvpb-1"
    records: list[ClinicalRecord] = field(default_factory=list)
    pending_tasks: list[PendingTask] = field(default_factory=list)
    events: list[ScheduledEvent] = field(default_factory=list)
    action_log: list[ActionRecord] = field(default_factory=list)
    public_log: list[DomainMessage] = field(default_factory=list)
    vitals: list[VitalsReading] = field(default_factory=list)
    drain: list[DrainReading] = field(default_factory=list)
    pain: list[PainReading] = field(default_factory=list)
    urine: list[UrineReading] = field(default_factory=list)
    fluid_support: int = 0
    fluids_given: bool = False
    transfused: bool = False
    analgesia: bool = False
    consult_count: int = 0
    monitor_alert_fired: bool = False
    deteriorated: bool = False
    diagnosis: str | None = None
    diag_spent: int = 0
    treat_spent: int = 0
    seq: int = 0
    cbc_count: int = 0
    repeat_while_pending: bool = False
    insufficient_funds: bool = False
    delayed_success: bool = False
    drug_overdose: bool = False
    case_ended_at: int | None = None
    revision: int = 0


def state_to_dict(s: SessionState) -> dict:
    return asdict(s)


def state_from_dict(raw: dict) -> SessionState:
    hidden = raw["hidden"]
    values = hidden.get("values")
    if values is None:
        # Migrate pre-physiology sessions (single bleeding axis).
        values = {"bleeding": hidden.get("bleeding_severity", 0.12)}
    physio = hidden.get("physio")
    if physio is None:
        # Migrate sessions saved before the compartment engine: derive the
        # compartment state from the hidden values at the case's baseline.
        from .case import get_case

        physio = get_case(raw.get("case_id", "mvpb-1")).physiology.initial(values)
    state = SessionState(
        hidden=HiddenClinicalState(
            values=values,
            physio=physio,
            reported_to_doctor=hidden["reported_to_doctor"],
            monitoring_enabled=hidden["monitoring_enabled"],
        ),
        current_time=raw["current_time"],
        case_status=raw["case_status"],
        case_id=raw.get("case_id", "mvpb-1"),
        monitor_alert_fired=raw.get("monitor_alert_fired", False),
        deteriorated=raw.get("deteriorated", False),
        diagnosis=raw.get("diagnosis"),
        fluid_support=raw.get("fluid_support", 0),
        fluids_given=raw.get("fluids_given", False),
        transfused=raw.get("transfused", False),
        analgesia=raw.get("analgesia", False),
        consult_count=raw.get("consult_count", 0),
        seq=raw.get("seq", 0),
        cbc_count=raw.get("cbc_count", 0),
        diag_spent=raw.get("diag_spent", 0),
        treat_spent=raw.get("treat_spent", 0),
        repeat_while_pending=raw.get("repeat_while_pending", False),
        insufficient_funds=raw.get("insufficient_funds", False),
        delayed_success=raw.get("delayed_success", False),
        drug_overdose=raw.get("drug_overdose", False),
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
    state.pain = [PainReading(**p) for p in raw.get("pain", [])]
    state.urine = [UrineReading(**u) for u in raw.get("urine", [])]
    return state
