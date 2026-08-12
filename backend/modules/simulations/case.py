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
    """The discrete compartment physiology engine per case.

    Hidden compartment state lives in ``hidden.physio`` (a plain dict so it
    serializes) and is advanced by ``step`` at each disease tick. Every
    observation is a pure function of (``values``, ``physio``) — never of
    future state — so readings stay deterministic and reproducible.

    ``bleeding`` is the primary disease axis accessor used by the course
    progression and thresholds; ``initial`` seeds the compartments; ``step``
    advances them. The rest produce what assessments/labs show.
    """

    bleeding: Callable[[dict], float]
    initial: Callable[[dict], dict]
    step: Callable[[dict, dict, dict, int], dict]
    vitals: Callable[[dict, dict], dict]
    vitals_abnormal: Callable[[dict], bool]
    drain: Callable[[dict], int]
    drain_abnormal: Callable[[int], bool]
    pain: Callable[[dict], int]
    pain_abnormal: Callable[[int], bool]
    urine: Callable[[dict, dict], int]
    urine_abnormal: Callable[[int], bool]
    hb: Callable[[dict, dict], float]
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
def _make_lab_kinds(axis: str, p: dict) -> dict[str, LabSpec]:
    """Build the case's lab catalog as closures over its disease axis.

    Every materializer is a pure function of the sample-time snapshot
    (values + physio + transfused flag), so results reflect the sampled
    moment and replay deterministically.
    """

    def sev_of(values: dict) -> float:
        return values[axis]

    def mat_cbc(sample_snapshot: dict, previous: dict | None) -> dict:
        values = sample_snapshot["values"]
        sev = sev_of(values)
        physio = sample_snapshot.get("physio") or {}
        hb = physio.get("hb", p["hb_base"] - p["hb_axis_rate"] * sev)
        if previous is not None and sev >= previous["sampled_severity"] and not sample_snapshot.get("transfused"):
            hb = min(hb, previous["hb"])  # ongoing loss never shows a rise; transfusion may
        wbc = p["wbc_base"] + p["wbc_gain"] * sev
        return {
            "hb": round(hb, 1),
            "wbc": round(wbc, 1),
            "platelet": 220,
            "sampled_severity": round(sev, 4),
            "abnormal": hb < p["hb_abn"] or wbc >= p["wbc_abn"],
        }

    def mat_abg(sample_snapshot: dict, previous: dict | None) -> dict:
        sev = sev_of(sample_snapshot["values"])
        physio = sample_snapshot.get("physio") or {}
        lactate = physio.get("lactate", p["lac_base"])
        ph = 7.42 - 0.08 * max(0.0, lactate - p["lac_base"])
        return {
            "lactate": round(lactate, 2),
            "ph": round(ph, 2),
            "sampled_severity": round(sev, 4),
            "abnormal": lactate >= 2.0 or ph < 7.35,
        }

    def mat_coag(sample_snapshot: dict, previous: dict | None) -> dict:
        sev = sev_of(sample_snapshot["values"])
        inr = 1.0 + p["inr_gain"] * sev
        return {
            "inr": round(inr, 2),
            "sampled_severity": round(sev, 4),
            "abnormal": inr > 1.2,
        }

    def mat_us(sample_snapshot: dict, previous: dict | None) -> dict:
        sev = sev_of(sample_snapshot["values"])
        positive = sev >= p["us_threshold"]
        return {
            "free_fluid": positive,
            "sampled_severity": round(sev, 4),
            "abnormal": positive,
        }

    return {
        "CBC": LabSpec("血常规(CBC)", p["cbc_cost"], p["cbc_turnaround"], mat_cbc),
        "ABG": LabSpec("动脉血气(ABG)", 60, 10, mat_abg),
        "COAG": LabSpec("凝血功能", 50, 20, mat_coag),
        "US": LabSpec("腹部超声", 120, 20, mat_us),
    }


# ── Physiology: discrete compartment engine (per-axis factory) ────────────
#
# Hidden compartment state (``hidden.physio``) advanced by ``step`` at each
# disease tick, with feedback loops between compartments and interventions:
#
#   vol    blood-volume fraction (1.0 = normal). The disease axis drains it;
#          fluids add a transient bolus (support decays per tick); transfusion
#          adds a sustained volume. Quasi-steady: reaches its axis-driven
#          target within one tick, so assessments read the current course.
#   svr    systemic vascular resistance multiplier (1.0 = normal). Baroreflex
#          raises it as vol falls (compensatory vasoconstriction defends BP);
#          an infection axis dilates vessels and lowers it. Slow (tau 12min).
#   lactate  mmol/L. Produced when vol falls below the perfusion threshold
#          (tissue hypoperfusion) plus any infection coupling; cleared toward
#          baseline once volume is restored — so early fluids/transfusion
#          genuinely reverse it, and ABG shows a time-dependent trend.
#   hb     g/L. Falls with the axis (bleeding drains it), boosted by
#          transfusion. Fast.
#
# Everything is a pure function of (values, physio): no RNG, no wall clock,
# fixed dt — replay of the same action sequence reproduces the same state.
# ``_make_physiology(axis, p)`` closes the shared engine over a case's axis
# reader and parameter table, so a second case is one more call, not a copy.

# Bleeding case parameters (MVP-B, calibrated anchors: HR 84@start / 95@0.34 /
# 108@0.60, deterioration 48min, failure 90min).
_PHYSIO_BLEED = {
    "vol_axis_rate": 0.35,  # steady-state volume fraction lost per unit axis
    "vol_fluid_per_unit": 0.05,  # volume fraction per active fluid-support unit
    "vol_transfuse": 0.04,  # sustained volume fraction while transfused
    "svr_gain": 2.0,  # resistance rise per unit vol deficit below threshold
    "svr_threshold": 0.88,  # vol below this triggers vasoconstriction
    "svr_tau_min": 12,  # SVR adaptation time constant
    "svr_infection": 0.8,  # resistance fall per unit infection axis (vasodilation)
    "lac_prod": 0.8,  # mmol/L per min at full perfusion deficit
    "lac_threshold": 0.88,  # vol below this → anaerobic production
    "lac_clear": 0.03,  # per-min fractional clearance above baseline
    "lac_base": 0.8,
    "lac_infection": 0.4,  # extra lactate per min per unit infection axis
    "hb_base": 145.0,
    "hb_axis_rate": 180.0,  # g/L fall per unit axis (bleeding drains Hb)
    "hb_transfuse": 25.0,  # g/L boost while transfused
    "hb_abn": 115.0,
    "hr_base": 78,
    "hr_vol_gain": 142.9,  # bpm per unit volume deficit
    "hr_infection": 30,  # fever tachycardia per unit infection axis
    "sbp_base": 122,
    "sbp_svr_gain": 0.15,  # BP defense per unit SVR above baseline
    "urine_base": 178,
    "urine_exp": 3.35,  # renal perfusion falls faster than volume
    "wbc_base": 8.5,
    "wbc_gain": 2.0,  # mild leukocytosis follows the axis
    "wbc_abn": 12.0,
    "inr_gain": 0.8,
    "us_threshold": 0.30,
    "cbc_cost": 35,
    "cbc_turnaround": 15,
    "temp_base": 37.0,
    "temp_axis_gain": 0.0,  # bleeding case stays afebrile
    "drain_base": 45,
    "drain_gain": 180,
    "pain_base": 1,
    "pain_gain": 8,
}


def _bleeding(values: dict) -> float:
    return values["bleeding"]


# Public knobs for intervention effects (fluids/transfusion act on compartments).
PHYSIO_VOL_FLUID_PER_UNIT = _PHYSIO_BLEED["vol_fluid_per_unit"]
PHYSIO_VOL_TRANSFUSE = _PHYSIO_BLEED["vol_transfuse"]
PHYSIO_HB_TRANSFUSE = _PHYSIO_BLEED["hb_transfuse"]


class CompartmentPhysiology:
    """The shared compartment engine closed over a case's disease axis.

    Each observation/lab accessor is a small pure method; ``spec`` binds them
    into the frozen ``PhysiologySpec`` the engine consumes.
    """

    def __init__(self, axis: str, p: dict):
        self._axis = axis
        self._p = p

    def bleeding(self, values: dict) -> float:
        return values[self._axis]

    def initial(self, values: dict) -> dict:
        sev = self.bleeding(values)
        p = self._p
        return {
            "vol": 1.0 - p["vol_axis_rate"] * sev,
            "svr": 1.0,
            "lactate": p["lac_base"],
            "hb": p["hb_base"] - p["hb_axis_rate"] * sev,
        }

    def step(self, values: dict, physio: dict, flags: dict, dt: int) -> dict:
        import math

        sev = self.bleeding(values)
        infection = values.get("infection", 0.0)
        support = flags.get("fluid_support", 0)
        transfused = flags.get("transfused", False)
        p = self._p

        # Volume: fast — snaps to its axis/intervention-driven target.
        vol_target = (
            1.0
            - p["vol_axis_rate"] * sev
            + p["vol_fluid_per_unit"] * support
            + (p["vol_transfuse"] if transfused else 0.0)
        )
        vol = min(1.05, max(0.4, vol_target))

        # SVR baroreflex: slow first-order adaptation, infection dilates.
        svr_target = 1.0 + p["svr_gain"] * max(0.0, p["svr_threshold"] - vol) - p["svr_infection"] * infection
        svr = physio["svr"] + (svr_target - physio["svr"]) * (1.0 - math.exp(-dt / p["svr_tau_min"]))

        # Lactate: integrates production (hypoperfusion) minus clearance.
        deficit = max(0.0, p["lac_threshold"] - vol)
        lactate = physio["lactate"] + (p["lac_prod"] * deficit + p["lac_infection"] * infection) * dt
        lactate -= p["lac_clear"] * max(0.0, lactate - p["lac_base"]) * dt
        lactate = max(p["lac_base"], lactate)

        # Hb: fast — axis drains (bleeding), transfusion boosts.
        hb = p["hb_base"] - p["hb_axis_rate"] * sev + (p["hb_transfuse"] if transfused else 0.0)

        return {"vol": vol, "svr": svr, "lactate": lactate, "hb": hb}

    def vitals(self, values: dict, physio: dict) -> dict:
        p = self._p
        vol = physio["vol"]
        svr = physio["svr"]
        infection = values.get("infection", 0.0)
        svr_defense = 1.0 + p["sbp_svr_gain"] * (svr - 1.0)
        return {
            "hr": p["hr_base"] + round(p["hr_vol_gain"] * (1.0 - vol)) + round(p["hr_infection"] * infection),
            "sbp": round(p["sbp_base"] * vol * svr_defense),
            "dbp": round((p["sbp_base"] - 42) * vol * svr_defense),
            "rr": 16 + round(10 * (1.0 - vol) * 3),
            "spo2": 98,
            "temp": p["temp_base"] + p["temp_axis_gain"] * self.bleeding(values),
        }

    def vitals_abnormal(self, v: dict) -> bool:
        return v["hr"] >= 95 or v["sbp"] <= 108 or v["temp"] >= 38.0

    def drain(self, values: dict) -> int:
        p = self._p
        return p["drain_base"] + round(p["drain_gain"] * self.bleeding(values))

    def drain_abnormal(self, output_ml: int) -> bool:
        return output_ml >= 80

    def pain(self, values: dict) -> int:
        p = self._p
        return min(10, p["pain_base"] + round(p["pain_gain"] * self.bleeding(values)))

    def pain_abnormal(self, score: int) -> bool:
        return score >= 4

    def urine(self, values: dict, physio: dict) -> int:
        """Renal perfusion follows blood volume: falls steeply as vol drops."""
        p = self._p
        vol = physio["vol"]
        return max(20, round(p["urine_base"] * vol ** p["urine_exp"]))

    def urine_abnormal(self, output_ml: int) -> bool:
        return output_ml < 120

    def hb_for(self, values: dict, physio: dict) -> float:
        return physio["hb"]

    def hb_abnormal(self, hb: float) -> bool:
        return hb < self._p["hb_abn"]

    def wbc_for(self, values: dict) -> float:
        p = self._p
        return round(p["wbc_base"] + p["wbc_gain"] * self.bleeding(values), 1)

    def spec(self) -> PhysiologySpec:
        return PhysiologySpec(
            bleeding=self.bleeding,
            initial=self.initial,
            step=self.step,
            vitals=self.vitals,
            vitals_abnormal=self.vitals_abnormal,
            drain=self.drain,
            drain_abnormal=self.drain_abnormal,
            pain=self.pain,
            pain_abnormal=self.pain_abnormal,
            urine=self.urine,
            urine_abnormal=self.urine_abnormal,
            hb=self.hb_for,
            hb_abnormal=self.hb_abnormal,
            wbc=self.wbc_for,
        )


# ── Narrative builders (embed derived vitals; per-case prose) ──
def _n_monitor_alert(alert_text: str):
    return lambda v: f"监护报警：HR {v['hr']} bpm，BP {v['sbp']}/{v['dbp']} mmHg，RR {v['rr']}。{alert_text}"


def _n_deterioration(deterioration_text: str):
    return lambda v: (
        f"患者病情明显恶化：HR {v['hr']} bpm，BP {v['sbp']}/{v['dbp']} mmHg，RR {v['rr']}。{deterioration_text}"
    )


_DURATIONS_BASE = {
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
    "TALK": 2,
}


def _build_case(
    *,
    case_id: str,
    name: str,
    patient: str,
    axis: str,
    physiology_params: dict,
    start_severity: float,
    step: float,
    mid_severity: float,
    deterioration_severity: float,
    failure_severity: float,
    diag_hint: str,
    handover_task: str,
    goal: str,
    monitor_alert: str,
    deterioration: str,
    failure: str,
    discharge: str,
    verdict_failure: str,
    verdict_delayed: str,
    verdict_timely: str,
    extra_durations: dict | None = None,
    extra_intervention_costs: dict | None = None,
) -> CaseSpec:
    """One playable case via the shared compartment engine + lab factory."""
    durations = {**_DURATIONS_BASE, **(extra_durations or {})}
    intervention_costs = {"FLUIDS": 30, "TRANSFUSE": 60, "ANALGESIA": 20, **(extra_intervention_costs or {})}
    return CaseSpec(
        name=name,
        version=case_id,
        start_clock="08:30",  # game minute 0 == 08:30
        patient=patient,
        course=CourseSpec(
            axis=axis,
            start_severity=start_severity,
            step=step,
            interval_min=6,
            mid_severity=mid_severity,
            deterioration_severity=deterioration_severity,
            failure_severity=failure_severity,
            fluid_progression_mult=0.5,  # transient, decays per tick
            transfuse_progression_mult=0.7,  # sustained until report
            analgesia_pain_mask=2,  # points hidden on pain assessment
        ),
        resources=ResourceSpec(
            diag_budget=400,
            treat_budget=100,
            consult_cost=120,
            intervention_costs=intervention_costs,
            durations=durations,
            lab_kinds=_make_lab_kinds(axis, physiology_params),
        ),
        narrative=NarrativeSpec(
            handover_task=handover_task,
            diag_hint=diag_hint,
            goal=goal,
            monitor_alert=_n_monitor_alert(monitor_alert),
            deterioration=_n_deterioration(deterioration),
            failure=lambda: failure,
            discharge=lambda: discharge,
            verdict_failure=verdict_failure,
            verdict_delayed=verdict_delayed,
            verdict_timely=verdict_timely,
        ),
        physiology=CompartmentPhysiology(axis, physiology_params).spec(),
    )


# ── Case registry (explicit, no runtime discovery) ──

# MVP-B: 腹部术后隐匿性出血 —— bleeding axis, calibrated anchors.
CASE = _build_case(
    case_id="mvpb-1",
    name="腹部术后隐匿性出血（MVP-B）",
    patient="王秀兰，58 岁女性，昨日胃癌根治术后，术后第 1 日，术后予低分子肝素预防 VTE",
    axis="bleeding",
    physiology_params=_PHYSIO_BLEED,
    start_severity=0.12,
    step=0.06,
    mid_severity=0.34,  # HR>=95 / SBP<=108; also the MONITOR_ALERT trigger
    deterioration_severity=0.60,
    failure_severity=1.0,
    diag_hint="疑诊隐匿性出血",
    handover_task="识别并有效报告隐匿性出血",
    goal="评估→检查→报告，识别并报告隐匿性出血，患者顺利出院。",
    monitor_alert="生命体征异常，请处理。",
    deterioration="引流增多，需立即处理。",
    failure="患者病情急剧恶化，隐匿性出血未被及时发现与控制——病例失败。",
    discharge="患者病情稳定，恢复良好，予以出院。较好结局达成。",
    verdict_failure="判定：延误/漏诊——未及时获得异常证据并有效报告，隐匿性出血持续加重。",
    verdict_delayed="判定：迟报成功——在病情明显恶化后才报告，处置及时但发现偏晚。",
    verdict_timely="判定：及时——在病情明显恶化前获得异常证据并有效报告，患者顺利出院。",
)

# MVP-I: 腹部术后腹腔感染 —— infection axis, fever + leukocytosis + lactate.
_PHYSIO_INFECTION = {
    **_PHYSIO_BLEED,
    "vol_axis_rate": 0.20,  # sepsis vasodilation → relative hypovolemia
    "hb_axis_rate": 0.0,  # infection does not drain Hb
    "hb_abn": 115.0,
    "temp_base": 37.0,
    "temp_axis_gain": 2.0,  # fever: T = 37 + 2*sev → 38.6 at sev 0.8
    "drain_base": 45,
    "drain_gain": 40,  # 引流液浑浊增多（感染渗出）
    "pain_base": 1,
    "pain_gain": 5,
    "wbc_base": 8.5,
    "wbc_gain": 12.0,  # 白细胞显著升高
    "wbc_abn": 11.0,
    "inr_gain": 0.4,
    "us_threshold": 0.45,  # 脓肿形成
    "cbc_cost": 35,
    "cbc_turnaround": 15,
}
CASE_INFECTION = _build_case(
    case_id="mvpi-1",
    name="腹部术后腹腔感染（MVP-I）",
    patient="刘国栋，64 岁男性，昨日胃大部切除术后，术后第 1 日，发热伴腹痛",
    axis="infection",
    physiology_params=_PHYSIO_INFECTION,
    start_severity=0.20,
    step=0.05,
    mid_severity=0.55,  # T 38.1 / HR~95; MONITOR_ALERT trigger
    deterioration_severity=0.75,  # 高热 + 血流动力学不稳定
    failure_severity=1.0,
    diag_hint="疑诊腹腔感染",
    handover_task="识别并有效报告术后腹腔感染（发热 + 白细胞升高 + 乳酸）",
    goal="评估→检查→报告，识别并报告腹腔感染，患者顺利出院。",
    monitor_alert="发热伴心率增快，警惕感染加重。",
    deterioration="高热持续，血压下降，感染性休克风险。需立即处理。",
    failure="感染性休克未被及时识别与控制——病例失败。",
    discharge="体温正常，感染控制良好，予以出院。较好结局达成。",
    verdict_failure="判定：延误/漏诊——未及时获得异常证据并有效报告，感染持续加重至休克。",
    verdict_delayed="判定：迟报成功——在病情明显恶化后才报告，处置及时但发现偏晚。",
    verdict_timely="判定：及时——在病情明显恶化前获得异常证据并有效报告，患者顺利出院。",
)


# ── Derived aliases (single source of truth is CASE) ──
CASE_NAME = CASE.name
CASE_VERSION = CASE.version
CASE_START_CLOCK = CASE.start_clock
PATIENT_DESC = CASE.patient

# ── Case registry (explicit, no runtime discovery) ──
CASES: dict[str, CaseSpec] = {"mvpb-1": CASE, "mvpi-1": CASE_INFECTION}


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
    The lab catalog is resolved from the session's case (snapshot carries
    ``case_id``), so each case materializes with its own axis/parameters.
    """
    case = get_case(sample_snapshot.get("case_id", "mvpb-1"))
    spec = case.resources.lab_kinds.get(kind)
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
