"""Case definitions for the clinical reasoning simulation.

The single source of truth for everything case-specific is ``CASE`` (a
``CaseSpec``): meta, hidden disease course, resource model, orderable labs and
narrative prose. Module-level aliases below are derived from ``CASE`` for
backward compatibility; new code should read ``CASE`` directly so a second case
can be added as one more ``CaseSpec`` in a registry.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class LabSpec:
    """One orderable test as a composed entity: cost in 检查点 and turnaround
    minutes, plus how its result is materialized from the sampled-time snapshot."""

    label: str
    cost: int
    turnaround: int
    materialize: Callable[[dict, dict | None], dict]


@dataclass(frozen=True)
class PhysiologySpec:
    """The physiology engine per case: deterministic mapping from the hidden
    ``values`` dict (multi-axis ready) to observable observations.

    ``bleeding`` is the primary disease axis accessor used by the course
    progression and thresholds; the rest produce what assessments/labs show.
    """

    bleeding: Callable[[dict], float]
    vitals: Callable[[dict], dict]
    vitals_abnormal: Callable[[dict], bool]
    drain: Callable[[dict], int]
    drain_abnormal: Callable[[int], bool]
    pain: Callable[[dict], int]
    pain_abnormal: Callable[[int], bool]
    urine: Callable[[dict], int]
    urine_abnormal: Callable[[int], bool]
    hb: Callable[[dict], float]
    hb_abnormal: Callable[[float], bool]
    wbc: Callable[[dict], float]


@dataclass(frozen=True)
class CourseSpec:
    """Hidden disease course: start/step/interval, thresholds, and how
    interventions modulate progression and mask observations."""

    axis: str
    start_severity: float
    step: float
    interval_min: int
    mid_severity: float
    deterioration_severity: float
    failure_severity: float
    fluid_progression_mult: float
    transfuse_progression_mult: float
    fluid_bp_mask_per_unit: int
    analgesia_pain_mask: int


@dataclass(frozen=True)
class ResourceSpec:
    """Two abstract pools (检查点 = labs+consult, 治疗点 = interventions) plus
    per-action durations. Time (minutes) is the third resource."""

    diag_budget: int
    treat_budget: int
    consult_cost: int
    intervention_costs: dict[str, int]
    durations: dict[str, int]
    lab_kinds: dict[str, LabSpec]


@dataclass(frozen=True)
class NarrativeSpec:
    """Case-specific prose. Event texts embed derived vitals, so they are
    builders taking the vitals dict."""

    handover_task: str
    diag_hint: str
    goal: str
    monitor_alert: Callable[[dict], str]
    deterioration: Callable[[dict], str]
    failure: Callable[[], str]
    discharge: Callable[[], str]
    verdict_failure: str
    verdict_delayed: str
    verdict_timely: str


@dataclass(frozen=True)
class CaseSpec:
    """One playable case — the aggregation point for everything case-specific."""

    name: str
    version: str
    start_clock: str
    patient: str
    course: CourseSpec
    resources: ResourceSpec
    narrative: NarrativeSpec
    physiology: PhysiologySpec


# ── Orderable labs (composed LabSpec entities) ──
def _mat_cbc(sample_snapshot: dict, previous: dict | None) -> dict:
    values = sample_snapshot["values"]
    sev = _bleeding(values)
    hb = hb_for(values)
    if previous is not None and sev >= previous["sampled_severity"]:
        hb = min(hb, previous["hb"])  # ongoing bleeding never shows a rise
    return {
        "hb": round(hb, 1),
        "wbc": wbc_for(values),
        "platelet": 220,
        "sampled_severity": round(sev, 4),
        "abnormal": hb_abnormal(hb),
    }


def _mat_abg(sample_snapshot: dict, previous: dict | None) -> dict:
    sev = _bleeding(sample_snapshot["values"])
    lactate = 0.8 + 6 * sev
    ph = 7.42 - 0.18 * sev
    return {
        "lactate": round(lactate, 2),
        "ph": round(ph, 2),
        "sampled_severity": round(sev, 4),
        "abnormal": lactate >= 2.0 or ph < 7.35,
    }


def _mat_coag(sample_snapshot: dict, previous: dict | None) -> dict:
    sev = _bleeding(sample_snapshot["values"])
    inr = 1.0 + 0.8 * sev
    return {
        "inr": round(inr, 2),
        "sampled_severity": round(sev, 4),
        "abnormal": inr > 1.2,
    }


def _mat_us(sample_snapshot: dict, previous: dict | None) -> dict:
    sev = _bleeding(sample_snapshot["values"])
    free_fluid = sev >= 0.30
    return {
        "free_fluid": free_fluid,
        "sampled_severity": round(sev, 4),
        "abnormal": free_fluid,
    }


# ── Physiology (deterministic hidden values → observations) ──
def _bleeding(values: dict) -> float:
    return values["bleeding"]


def vitals(values: dict) -> dict:
    """Deterministic vital-signs snapshot for the bleeding axis."""
    severity = _bleeding(values)
    return {
        "hr": 78 + round(50 * severity),
        "sbp": 122 - round(45 * severity),
        "dbp": 80 - round(20 * severity),
        "rr": 16 + round(10 * severity),
        "spo2": 98,
        "temp": 37.0,
    }


def vitals_abnormal(v: dict) -> bool:
    return v["hr"] >= 95 or v["sbp"] <= 108


def drain_output(values: dict) -> int:
    return 45 + round(180 * _bleeding(values))


def drain_abnormal(output_ml: int) -> bool:
    return output_ml >= 80


def pain_score(values: dict) -> int:
    return min(10, 1 + round(8 * _bleeding(values)))


def pain_abnormal(score: int) -> bool:
    return score >= 4


def urine_output(values: dict) -> int:
    return max(20, 200 - round(180 * _bleeding(values)))


def urine_abnormal(output_ml: int) -> bool:
    return output_ml < 120


def hb_for(values: dict) -> float:
    return 145 - 180 * _bleeding(values)


def hb_abnormal(hb: float) -> bool:
    return hb < 115


def wbc_for(values: dict) -> float:
    return round(8.5 + 2 * _bleeding(values), 1)


# ── Narrative builders (embed derived vitals) ──
def _n_monitor_alert(v: dict) -> str:
    return f"监护报警：HR {v['hr']} bpm，BP {v['sbp']}/{v['dbp']} mmHg，RR {v['rr']}。生命体征异常，请处理。"


def _n_deterioration(v: dict) -> str:
    return f"患者病情明显恶化：HR {v['hr']} bpm，BP {v['sbp']}/{v['dbp']} mmHg，引流增多。需立即处理。"


def _n_failure() -> str:
    return "患者病情急剧恶化，隐匿性出血未被及时发现与控制——病例失败。"


def _n_discharge() -> str:
    return "患者病情稳定，恢复良好，予以出院。较好结局达成。"


# ── The single case (aggregation point) ──
CASE = CaseSpec(
    name="腹部术后隐匿性出血（MVP-B）",
    version="mvpb-1",
    start_clock="08:30",  # game minute 0 == 08:30
    patient="王秀兰，58 岁女性，昨日胃癌根治术后，术后第 1 日，术后予低分子肝素预防 VTE",
    course=CourseSpec(
        axis="bleeding",
        start_severity=0.12,
        step=0.06,
        interval_min=6,
        mid_severity=0.34,  # HR>=95 / SBP<=108; also the MONITOR_ALERT trigger
        deterioration_severity=0.60,
        failure_severity=1.0,
        fluid_progression_mult=0.5,  # transient, decays per tick
        transfuse_progression_mult=0.7,  # sustained until report
        fluid_bp_mask_per_unit=10,  # mmHg hidden per support unit on manual vitals
        analgesia_pain_mask=2,  # points hidden on pain assessment
    ),
    resources=ResourceSpec(
        diag_budget=400,
        treat_budget=100,
        consult_cost=120,
        intervention_costs={"FLUIDS": 30, "TRANSFUSE": 60, "ANALGESIA": 20},
        durations={
            "ASSESS_VITALS": 2,
            "ASSESS_DRAIN": 3,
            "ASSESS_PAIN": 1,
            "ASSESS_URINE": 2,
            "ORDER_LAB": 3,
            "MONITOR": 2,
            "CONSULT": 2,
            "FLUIDS": 3,
            "TRANSFUSE": 5,
            "ANALGESIA": 1,
            "REPORT": 2,
        },
        lab_kinds={
            "CBC": LabSpec("血常规(CBC)", 35, 15, _mat_cbc),
            "ABG": LabSpec("动脉血气(ABG)", 60, 10, _mat_abg),
            "COAG": LabSpec("凝血功能", 50, 20, _mat_coag),
            "US": LabSpec("腹部超声", 120, 20, _mat_us),
        },
    ),
    narrative=NarrativeSpec(
        handover_task="识别并有效报告隐匿性出血",
        diag_hint="疑诊隐匿性出血",
        goal="评估→检查→报告，识别并报告隐匿性出血，患者顺利出院。",
        monitor_alert=_n_monitor_alert,
        deterioration=_n_deterioration,
        failure=_n_failure,
        discharge=_n_discharge,
        verdict_failure="判定：延误/漏诊——未及时获得异常证据并有效报告，隐匿性出血持续加重。",
        verdict_delayed="判定：迟报成功——在病情明显恶化后才报告，处置及时但发现偏晚。",
        verdict_timely="判定：及时——在病情明显恶化前获得异常证据并有效报告，患者顺利出院。",
    ),
    physiology=PhysiologySpec(
        bleeding=_bleeding,
        vitals=vitals,
        vitals_abnormal=vitals_abnormal,
        drain=drain_output,
        drain_abnormal=drain_abnormal,
        pain=pain_score,
        pain_abnormal=pain_abnormal,
        urine=urine_output,
        urine_abnormal=urine_abnormal,
        hb=hb_for,
        hb_abnormal=hb_abnormal,
        wbc=wbc_for,
    ),
)


# ── Derived aliases (single source of truth is CASE) ──
CASE_NAME = CASE.name
CASE_VERSION = CASE.version
CASE_START_CLOCK = CASE.start_clock
PATIENT_DESC = CASE.patient

# ── Case registry (explicit, no runtime discovery) ──
CASES: dict[str, CaseSpec] = {"mvpb-1": CASE}


def get_case(case_id: str) -> CaseSpec:
    case = CASES.get(case_id)
    if case is None:
        raise ValueError(f"未知病例：{case_id}")
    return case


def case_options_text() -> str:
    return "、".join(f"{cid} {c.name}" for cid, c in CASES.items())


def case_of(state) -> CaseSpec:
    """Resolve the case a session is bound to (duck-typed: reads ``case_id``)."""
    return CASES.get(getattr(state, "case_id", "mvpb-1"), CASE)


SEVERITY_START = CASE.course.start_severity
SEVERITY_STEP = CASE.course.step
BLEEDING_INTERVAL_MIN = CASE.course.interval_min
VITALS_MID_SEVERITY = CASE.course.mid_severity
DETERIORATION_SEVERITY = CASE.course.deterioration_severity
FAILURE_SEVERITY = CASE.course.failure_severity
FLUID_PROGRESSION_MULT = CASE.course.fluid_progression_mult
TRANSFUSE_PROGRESSION_MULT = CASE.course.transfuse_progression_mult
FLUID_BP_MASK_PER_UNIT = CASE.course.fluid_bp_mask_per_unit
ANALGESIA_PAIN_MASK = CASE.course.analgesia_pain_mask

DIAG_BUDGET_START = CASE.resources.diag_budget
TREAT_BUDGET_START = CASE.resources.treat_budget
CONSULT_COST = CASE.resources.consult_cost
INTERVENTION_COSTS = CASE.resources.intervention_costs
DURATION_MIN = CASE.resources.durations
LAB_KINDS = CASE.resources.lab_kinds


def materialize_lab(kind: str, sample_snapshot: dict, previous: dict | None) -> dict:
    """On-demand, one-shot materialization reflecting the sampled-time state.

    A lab is materialized only once (when its READY event fires) and only from
    the light snapshot saved at sampling time — never from result-return time.
    ``previous`` is the latest same-kind result, used for monotonic trends.
    """
    spec = LAB_KINDS.get(kind)
    if spec is None:
        raise ValueError(f"unknown lab kind: {kind}")
    return spec.materialize(sample_snapshot, previous)


def lab_options_text() -> str:
    return "、".join(
        f"{LAB_KINDS[k].label}（{LAB_KINDS[k].cost}检查点/{LAB_KINDS[k].turnaround}min）" for k in sorted(LAB_KINDS)
    )


def clock_text(minute: int) -> str:
    total = 8 * 60 + 30 + minute
    hh = (total // 60) % 24
    mm = total % 60
    return f"{hh:02d}:{mm:02d}"
