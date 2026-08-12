"""Session state dataclasses for the clinical reasoning simulation.

These are pure runtime values held inside a single JSONB column. The ORM
table lives in ``models/simulation.py``; this module is the in-memory shape
the engine operates on (and serializes to/from for persistence).
"""

from dataclasses import asdict, dataclass, field
from typing import cast


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
class GlucoseReading(Reading):
    """指尖血糖（mmol/L）— 内科评估目标。"""

    mmol: float


@dataclass
class BreathReading(Reading):
    """肺部听诊 — 呼吸音分类，提示肺水肿/感染/正常。"""

    sound: str  # clear / crackles / wheeze / diminished


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
    # Generic observation container: target name → readings list. Every
    # assessment target (vitals/drain/pain/urine/…) writes here; the engine
    # and snapshot iterate it, so a new assessment target needs no new field.
    readings: dict[str, list[Reading]] = field(default_factory=dict)
    fluid_support: int = 0

    @property
    def vitals(self) -> list[VitalsReading]:
        return cast("list[VitalsReading]", self.readings.get("vitals", []))

    @property
    def drain(self) -> list[DrainReading]:
        return cast("list[DrainReading]", self.readings.get("drain", []))

    @property
    def pain(self) -> list[PainReading]:
        return cast("list[PainReading]", self.readings.get("pain", []))

    @property
    def urine(self) -> list[UrineReading]:
        return cast("list[UrineReading]", self.readings.get("urine", []))

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
    # Fold legacy + serialized readings into typed Reading instances.
    _READING_TYPES = {
        "vitals": VitalsReading,
        "drain": DrainReading,
        "pain": PainReading,
        "urine": UrineReading,
        "glucose": GlucoseReading,
        "breath": BreathReading,
    }
    readings: dict[str, list[Reading]] = {}
    for key, raw_list in (raw.get("readings") or {}).items():
        cls = _READING_TYPES.get(key, Reading)
        readings[key] = [cls(**r) if isinstance(r, dict) else r for r in raw_list]
    for key, cls in _READING_TYPES.items():
        legacy = raw.get(key)
        if legacy and key not in readings:
            readings[key] = [cls(**r) for r in legacy]
    state.readings = readings
    return state
