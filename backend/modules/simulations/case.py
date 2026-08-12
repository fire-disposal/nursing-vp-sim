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
class DrugSpec:
    """One administrable drug: pharmacokinetics + effects + adverse reactions.

    ``plasma`` concentration decays exponentially (half-life); ``cumulative``
    tracks total administered amount for overdose detection. Effects are
    linear in plasma concentration; adverse reactions (respiratory
    depression, sedation) scale with it too, so repeated dosing — the
    "spam analgesics" trap — produces real, observable consequences.

    ``progression_mult`` slows the hidden disease axis while on board
    (transfusion slows bleeding, antibiotics slow infection). Antibiotics
    are infection-case only: a case declares its drug surface, so the command
    set is genuinely per-specialty, not a fixed answer machine.
    """

    label: str
    category: str  # 分类名录: 镇痛 / 抗感染 / 呼吸支持 / 液体与容量 / 循环支持
    unit: str  # mg / ml / U / L
    default_dose: float
    max_dose: float  # single-dose ceiling; exceeding it is rejected
    half_life_min: float
    cost: int  # 治疗点
    duration_min: int  # administration time
    vol_per_dose: float = 0.0  # immediate volume effect per dose (fluids/transfusion)
    hb_per_dose: float = 0.0  # hemoglobin effect per dose (transfusion)
    pain_reduction: float = 0.0  # VAS points masked per unit plasma (analgesia)
    resp_depression: float = 0.0  # RR/SpO2 suppression per unit plasma (opioids)
    sedation: float = 0.0  # consciousness loss per unit plasma (opioids)
    spo2_boost: float = 0.0  # SpO2 points per unit plasma (oxygen)
    svr_gain: float = 0.0  # systemic resistance effect per unit plasma (vasopressors)
    vol_drain: float = 0.0  # volume removed per unit plasma (diuretics)
    progression_mult: float = 1.0  # disease-axis progression multiplier while active
    toxicity_threshold: float = 1e9  # cumulative dose beyond which an adverse event fires
    toxicity_label: str = ""  # what the overdose reaction is called


# Global drug registry — drugs are universal; cases declare which they stock.
# Per-case dosing/side-effect intensity can differ by passing a param dict
# through ``_build_case`` (see the per-case drug surfaces below).
DRUGS: dict[str, DrugSpec] = {
    "FLUIDS": DrugSpec(
        label="快速补液",
        category="液体与容量",
        unit="ml",
        default_dose=500,
        max_dose=1500,
        half_life_min=30,  # bolus support fades quickly
        cost=30,
        duration_min=3,
        vol_per_dose=0.10,
        toxicity_threshold=2000,
        toxicity_label="容量超负荷（肺水肿风险）",
    ),
    "TRANSFUSE": DrugSpec(
        label="输注红细胞",
        category="液体与容量",
        unit="U",
        default_dose=2,
        max_dose=4,
        half_life_min=180,
        cost=60,
        duration_min=5,
        vol_per_dose=0.04,
        hb_per_dose=25.0,
        progression_mult=0.7,  # slows the bleed, sustained until reported
        toxicity_threshold=6,
        toxicity_label="输血反应",
    ),
    "MORPHINE": DrugSpec(
        label="吗啡",
        category="镇痛",
        unit="mg",
        default_dose=5,
        max_dose=15,
        half_life_min=90,
        cost=20,
        duration_min=1,
        pain_reduction=2.0,  # VAS points masked per unit plasma
        resp_depression=0.9,  # strong respiratory drive suppression
        sedation=0.12,  # heavy sedation per unit plasma
        toxicity_threshold=40,  # cumulative mg beyond which: respiratory failure
        toxicity_label="呼吸抑制（吗啡过量）",
    ),
    "NSAID": DrugSpec(
        label="布洛芬",
        category="镇痛",
        unit="mg",
        default_dose=400,
        max_dose=1200,
        half_life_min=120,
        cost=15,
        duration_min=2,
        pain_reduction=1.0,  # mild analgesia, no respiratory effect
        toxicity_threshold=2400,
        toxicity_label="急性肾损伤（NSAID 过量）",
    ),
    "OXYGEN": DrugSpec(
        label="给氧",
        category="呼吸支持",
        unit="L/min",
        default_dose=3,
        max_dose=10,
        half_life_min=15,  # effect wears off minutes after stopping
        cost=10,
        duration_min=2,
        spo2_boost=3.0,  # SpO2 points per unit
    ),
    "ANTIBIOTIC": DrugSpec(
        label="抗生素",
        category="抗感染",
        unit="g",
        default_dose=1,
        max_dose=2,
        half_life_min=120,
        cost=40,
        duration_min=5,
        progression_mult=0.55,  # suppresses the infection axis
        toxicity_threshold=8,
        toxicity_label="抗生素过敏/肾损伤",
    ),
    "DIURETIC": DrugSpec(
        label="呋塞米",
        category="液体与容量",
        unit="mg",
        default_dose=20,
        max_dose=80,
        half_life_min=90,
        cost=25,
        duration_min=2,
        vol_drain=0.08,  # removes volume per unit plasma
        toxicity_threshold=160,
        toxicity_label="过度利尿（低血容量）",
    ),
    "VASOPRESSOR": DrugSpec(
        label="去甲肾上腺素",
        category="循环支持",
        unit="µg/min",
        default_dose=5,
        max_dose=30,
        half_life_min=5,  # short-lived; effect only while infusion runs
        cost=35,
        duration_min=2,
        svr_gain=0.25,  # raises SVR/BP per unit plasma
        toxicity_threshold=60,
        toxicity_label="末梢灌注恶化（血管过度收缩）",
    ),
    "INSULIN": DrugSpec(
        label="胰岛素",
        category="代谢",
        unit="U",
        default_dose=5,
        max_dose=15,
        half_life_min=45,
        cost=25,
        duration_min=2,
        toxicity_threshold=30,
        toxicity_label="低血糖（胰岛素过量）",
    ),
    "SALBUTAMOL": DrugSpec(
        label="沙丁胺醇",
        category="呼吸支持",
        unit="喷",
        default_dose=2,
        max_dose=8,
        half_life_min=60,
        cost=15,
        duration_min=2,
        toxicity_threshold=20,
        toxicity_label="心动过速/震颤（β激动剂过量）",
    ),
    "GLUCOSE": DrugSpec(
        label="静脉葡萄糖",
        category="代谢",
        unit="g",
        default_dose=25,
        max_dose=50,
        half_life_min=30,
        cost=10,
        duration_min=1,
        toxicity_threshold=200,
        toxicity_label="高血糖（补糖过量）",
    ),
}


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
    pain: Callable[[dict, dict], int]
    pain_abnormal: Callable[[int], bool]
    urine: Callable[[dict, dict], int]
    urine_abnormal: Callable[[int], bool]
    hb: Callable[[dict, dict], float]
    hb_abnormal: Callable[[float], bool]
    wbc: Callable[[dict], float]
    glucose: Callable[[dict, dict], float]
    glucose_abnormal: Callable[[float], bool]
    breath: Callable[[dict, dict], str]
    breath_abnormal: Callable[[str], bool]
    consciousness: Callable[[dict, dict], float]


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
class SurfaceSpec:
    """The player-facing command surface — what this case exposes.

    A case is not an answer machine with a fixed menu: it declares its own
    assessment targets, stocked drugs, dialogue roles and wait targets. The
    engine dispatches generically against this surface, so a new specialty is
    a new surface + params, not a rewrite of the command layer.
    """

    assessments: dict[str, str]  # /assess target → label (e.g. {"vitals": "生命体征"})
    drugs: dict[str, str]  # /give drug key → label (stocked drugs only)
    talk_roles: tuple[str, ...] = ("patient", "family")
    wait_labs: bool = True  # /wait <lab> supported
    monitor: bool = True  # /monitor supported


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
    surface: SurfaceSpec


# ── Orderable labs (composed LabSpec entities) ──
def _make_lab_kinds(axis: str, coupling: dict, k: dict) -> dict[str, LabSpec]:
    """Build the case's lab catalog as closures over its disease axis.

    Every materializer is a pure function of the sample-time snapshot
    (values + physio + transfused flag), so results reflect the sampled
    moment and replay deterministically. Lab behavior comes from the shared
    kernel constants plus the case's coupling table — no bespoke equations.
    """

    def sev_of(values: dict) -> float:
        return values[axis]

    def mat_cbc(sample_snapshot: dict, previous: dict | None) -> dict:
        values = sample_snapshot["values"]
        sev = sev_of(values)
        physio = sample_snapshot.get("physio") or {}
        hb = physio.get("hb", k["hb_base"] - coupling.get("hb_axis_rate", 0.0) * sev)
        if previous is not None and sev >= previous["sampled_severity"] and not sample_snapshot.get("transfused"):
            hb = min(hb, previous["hb"])  # ongoing loss never shows a rise; transfusion may
        wbc = k["wbc_base"] + coupling.get("wbc_axis_gain", 0.0) * sev
        wbc_abn = coupling.get("wbc_abn", k["wbc_abn"])
        return {
            "hb": round(hb, 1),
            "wbc": round(wbc, 1),
            "platelet": 220,
            "sampled_severity": round(sev, 4),
            "abnormal": hb < coupling.get("hb_abn", k["hb_abn"]) or wbc >= wbc_abn,
        }

    def mat_abg(sample_snapshot: dict, previous: dict | None) -> dict:
        sev = sev_of(sample_snapshot["values"])
        physio = sample_snapshot.get("physio") or {}
        lactate = physio.get("lactate", k["lac_base"])
        ph = 7.42 - 0.08 * max(0.0, lactate - k["lac_base"])
        return {
            "lactate": round(lactate, 2),
            "ph": round(ph, 2),
            "sampled_severity": round(sev, 4),
            "abnormal": lactate >= 2.0 or ph < 7.35,
        }

    def mat_coag(sample_snapshot: dict, previous: dict | None) -> dict:
        sev = sev_of(sample_snapshot["values"])
        inr = 1.0 + k["inr_gain"] * sev
        return {
            "inr": round(inr, 2),
            "sampled_severity": round(sev, 4),
            "abnormal": inr > 1.2,
        }

    def mat_us(sample_snapshot: dict, previous: dict | None) -> dict:
        sev = sev_of(sample_snapshot["values"])
        positive = sev >= k["us_threshold"]
        return {
            "free_fluid": positive,
            "sampled_severity": round(sev, 4),
            "abnormal": positive,
        }

    return {
        "CBC": LabSpec("血常规(CBC)", k["cbc_cost"], k["cbc_turnaround"], mat_cbc),
        "ABG": LabSpec("动脉血气(ABG)", 60, 10, mat_abg),
        "COAG": LabSpec("凝血功能", 50, 20, mat_coag),
        "US": LabSpec("腹部超声", 120, 20, mat_us),
    }


# ── Physiology: one universal in-hospital medicine state machine ───────────
#
# The KERNEL is case-agnostic. A case is not a rewrite of the equations — it
# is an initial condition plus an axis→physiology coupling table:
#
#   course.axis       which hidden severity drives the case (bleeding/infection)
#   coupling          coefficients: how each unit of axis severity moves the
#                     shared compartments (vol↓, hb↓, temp↑, svr↓, hr↑, wbc↑)
#   physio_init       starting compartment values (seeded from start severity)
#
# The kernel owns the physiology every in-hospital case shares:
#
#   vol     blood-volume fraction. Fluid boluses expand it (transient),
#           transfusion sustains it, diuretics drain it, the axis drains it.
#   svr     systemic vascular resistance. Baroreflex raises it as vol falls
#           (compensatory vasoconstriction); the axis may dilate vessels;
#           vasopressors raise it. First-order, tau 12min.
#   lactate integrator: produced by tissue hypoperfusion (vol below threshold)
#           plus axis coupling; cleared once perfusion returns. Emergent ABG.
#   hb      falls with the axis (bleeding), boosted by transfusion. Fast.
#   meds    per-drug plasma concentration (half-life decay) + cumulative dose
#           (drives overdose). Effects and adverse reactions scale with plasma.
#   conscious 0..1: driven by perfusion, oxygenation and sedation. Gates talk.
#
# Pure functions of (values, physio): no RNG, no wall clock, fixed dt — the
# same action sequence replays to the same state.

# Universal physiology constants — shared by every case, not per-case data.
_KERNEL = {
    "vol_fluid_per_unit": 0.05,  # volume fraction per active fluid-support unit
    "vol_transfuse": 0.04,  # sustained volume fraction while transfused
    "svr_gain": 2.0,  # resistance rise per unit vol deficit below threshold
    "svr_threshold": 0.88,  # vol below this triggers vasoconstriction
    "svr_tau_min": 12,  # SVR adaptation time constant
    "lac_prod": 0.8,  # mmol/L per min at full perfusion deficit
    "lac_threshold": 0.88,  # vol below this → anaerobic production
    "lac_clear": 0.03,  # per-min fractional clearance above baseline
    "lac_base": 0.8,
    "hb_base": 145.0,
    "hb_transfuse": 25.0,  # g/L boost while transfused
    "hb_abn": 115.0,
    "hr_base": 78,
    "hr_vol_gain": 142.9,  # bpm per unit volume deficit
    "sbp_base": 122,
    "sbp_svr_gain": 0.15,  # BP defense per unit SVR above baseline
    "urine_base": 178,
    "urine_exp": 3.35,  # renal perfusion falls faster than volume
    "wbc_base": 8.5,
    "wbc_abn": 12.0,
    "inr_gain": 0.8,
    "us_threshold": 0.30,
    "cbc_cost": 35,
    "cbc_turnaround": 15,
    "temp_base": 37.0,
    "drain_base": 45,
    "pain_base": 1,
    "glucose_base": 5.5,  # mmol/L fasting baseline
    "glucose_insulin_per_unit": 2.5,  # mmol/L drop per unit insulin plasma
    "glucose_dextrose_per_unit": 1.5,  # mmol/L rise per unit dextrose plasma
    "glucose_lo": 3.9,
    "glucose_hi": 11.1,
}


# Typed shape of one drug's kinetic state.
MedState = dict[str, float]  # plasma / cumulative / doses


def active_meds(physio: dict) -> dict[str, MedState]:
    """Typed accessor for the meds compartment: {drug_key: {plasma, cumulative, doses}}."""
    meds = physio.get("meds")
    return meds if isinstance(meds, dict) else {}


# Public knobs for intervention effects (fluids/transfusion act on compartments).
PHYSIO_VOL_FLUID_PER_UNIT = _KERNEL["vol_fluid_per_unit"]
PHYSIO_VOL_TRANSFUSE = _KERNEL["vol_transfuse"]
PHYSIO_HB_TRANSFUSE = _KERNEL["hb_transfuse"]


class InternalMedicineKernel:
    """The ONE in-hospital medicine physiology kernel.

    A case supplies only: ``axis`` (which hidden severity drives it) and
    ``coupling`` (how each unit of axis severity moves the shared
    compartments). The equations below are universal — every internal/surgical
    ward case runs the same machine; cases are initial conditions, not code.
    """

    def __init__(self, axis: str, coupling: dict):
        self._axis = axis
        self._c = coupling  # per-unit axis→physiology coupling coefficients
        self._k = _KERNEL  # universal constants

    def _thr(self, key: str) -> float:
        """Threshold (e.g. wbc_abn) — kernel default, overridable per case."""
        return self._c.get(key, self._k[key])

    def bleeding(self, values: dict) -> float:
        return values[self._axis]

    def initial(self, values: dict) -> dict:
        sev = self.bleeding(values)
        c, k = self._c, self._k
        return {
            "vol": 1.0 - c.get("vol_axis_rate", 0.0) * sev,
            "svr": 1.0,
            "lactate": k["lac_base"],
            "hb": k["hb_base"] - c.get("hb_axis_rate", 0.0) * sev,
            "meds": {},
            "conscious": 1.0,
        }

    @staticmethod
    def _meds_decay(meds: dict, dt: int) -> dict:
        """First-order elimination: plasma *= 2^(-dt/half_life). Cumulative
        and dose counts persist (cumulative drives overdose detection)."""
        import math

        out = {}
        for key, med in meds.items():
            spec = DRUGS.get(key)
            if spec is None:
                continue
            plasma = med["plasma"] * math.exp(-math.log(2) * dt / spec.half_life_min)
            out[key] = {"plasma": plasma, "cumulative": med["cumulative"], "doses": med["doses"]}
        return out

    def step(self, values: dict, physio: dict, flags: dict, dt: int) -> dict:
        import math

        sev = self.bleeding(values)
        support = flags.get("fluid_support", 0)
        transfused = flags.get("transfused", False)
        c, k = self._c, self._k
        meds = self._meds_decay(physio.get("meds", {}), dt)

        # Vasopressor raises SVR (BP support); diuretic drains volume.
        pressor = sum(meds[k_]["plasma"] * DRUGS[k_].svr_gain for k_ in meds if k_ in DRUGS)
        drain = sum(meds[k_]["plasma"] * DRUGS[k_].vol_drain for k_ in meds if k_ in DRUGS)

        # Volume: fast — snaps to axis/intervention-driven target.
        vol_target = (
            1.0
            - c.get("vol_axis_rate", 0.0) * sev
            + k["vol_fluid_per_unit"] * support
            + (k["vol_transfuse"] if transfused else 0.0)
        )
        vol = min(1.05, max(0.4, vol_target - drain))

        # SVR baroreflex: slow first-order adaptation; axis may dilate;
        # vasopressors add resistance.
        svr_target = (
            1.0 + k["svr_gain"] * max(0.0, k["svr_threshold"] - vol) - c.get("svr_axis_dilate", 0.0) * sev + pressor
        )
        svr = physio["svr"] + (svr_target - physio["svr"]) * (1.0 - math.exp(-dt / k["svr_tau_min"]))

        # Lactate: integrates production (hypoperfusion + axis) minus clearance.
        deficit = max(0.0, k["lac_threshold"] - vol)
        lactate = physio["lactate"] + (k["lac_prod"] * deficit + c.get("lac_axis_gain", 0.0) * sev) * dt
        lactate -= k["lac_clear"] * max(0.0, lactate - k["lac_base"]) * dt
        lactate = max(k["lac_base"], lactate)

        # Hb: fast — axis drains (bleeding), transfusion boosts.
        hb = k["hb_base"] - c.get("hb_axis_rate", 0.0) * sev + (k["hb_transfuse"] if transfused else 0.0)

        # Consciousness: perfusion + oxygenation + sedation.
        conscious = self._consciousness(vol, meds, sev)
        sed = sum(meds[k_]["plasma"] * DRUGS[k_].sedation for k_ in meds if k_ in DRUGS)
        return {
            "vol": vol,
            "svr": svr,
            "lactate": lactate,
            "hb": hb,
            "meds": meds,
            "conscious": conscious,
            "sedation": sed,
        }

    def _consciousness(self, vol: float, meds: dict, sev: float) -> float:
        """0..1 — perfusion and oxygenation keep the patient awake; sedation
        and overwhelming illness pull them under."""
        perf = min(1.0, max(0.0, vol / 0.72))
        oxy = min(1.0, max(0.0, (98.0 - 82.0) / 16.0))
        sed = sum(meds[k]["plasma"] * DRUGS[k].sedation for k in meds if k in DRUGS)
        illness = self._c.get("conscious_axis_gain", 0.0) * sev
        return max(0.0, min(1.0, 0.35 * perf + 0.30 * oxy + 0.25 - sed - illness))

    def vitals(self, values: dict, physio: dict) -> dict:
        c, k = self._c, self._k
        vol = physio["vol"]
        svr = physio["svr"]
        meds = physio.get("meds", {})
        svr_defense = 1.0 + k["sbp_svr_gain"] * (svr - 1.0)

        # Respiratory drive: opioids suppress it; oxygen supports SpO2.
        resp_dep = sum(meds[k_]["plasma"] * DRUGS[k_].resp_depression for k_ in meds if k_ in DRUGS)
        spo2_boost = sum(meds[k_]["plasma"] * DRUGS[k_].spo2_boost for k_ in meds if k_ in DRUGS)
        base_rr = 16 + round(10 * (1.0 - vol) * 3)
        rr = max(8, base_rr - round(resp_dep * 6))
        spo2 = max(60, min(100, round(98 - resp_dep * 8 + spo2_boost)))
        return {
            "hr": k["hr_base"]
            + round(k["hr_vol_gain"] * (1.0 - vol))
            + round(c.get("hr_axis_gain", 0.0) * self.bleeding(values)),
            "sbp": round(k["sbp_base"] * vol * svr_defense),
            "dbp": round((k["sbp_base"] - 42) * vol * svr_defense),
            "rr": rr,
            "spo2": spo2,
            "temp": k["temp_base"] + c.get("temp_axis_gain", 0.0) * self.bleeding(values),
        }

    def vitals_abnormal(self, v: dict) -> bool:
        return v["hr"] >= 95 or v["sbp"] <= 108 or v["temp"] >= 38.0 or v["spo2"] <= 92 or v["rr"] <= 10

    def drain(self, values: dict) -> int:
        c, k = self._c, self._k
        return k["drain_base"] + round(c.get("drain_axis_gain", 0.0) * self.bleeding(values))

    def drain_abnormal(self, output_ml: int) -> bool:
        return output_ml >= 80

    def pain(self, values: dict, physio: dict) -> int:
        c, k = self._c, self._k
        raw = k["pain_base"] + round(c.get("pain_axis_gain", 0.0) * self.bleeding(values))
        masked = sum(physio.get("meds", {}).get(k_, {}).get("plasma", 0.0) * DRUGS[k_].pain_reduction for k_ in DRUGS)
        return min(10, max(0, raw - round(masked)))

    def pain_abnormal(self, score: int) -> bool:
        return score >= 4

    def urine(self, values: dict, physio: dict) -> int:
        """Renal perfusion follows blood volume: falls steeply as vol drops."""
        k = self._k
        vol = physio["vol"]
        return max(20, round(k["urine_base"] * vol ** k["urine_exp"]))

    def urine_abnormal(self, output_ml: int) -> bool:
        return output_ml < 120

    def hb_for(self, values: dict, physio: dict) -> float:
        return physio["hb"]

    def hb_abnormal(self, hb: float) -> bool:
        return hb < self._thr("hb_abn")

    def wbc_for(self, values: dict) -> float:
        c, k = self._c, self._k
        return round(k["wbc_base"] + c.get("wbc_axis_gain", 0.0) * self.bleeding(values), 1)

    def wbc_abnormal(self, wbc: float) -> bool:
        return wbc >= self._thr("wbc_abn")

    def glucose(self, values: dict, physio: dict) -> float:
        """Fingerstick glucose (mmol/L) — baseline + axis coupling + insulin/dextrose."""
        c, k = self._c, self._k
        g = k["glucose_base"] + c.get("glucose_axis_gain", 0.0) * self.bleeding(values)
        insulin = active_meds(physio).get("INSULIN", {}).get("plasma", 0.0)
        dextrose = active_meds(physio).get("GLUCOSE", {}).get("plasma", 0.0)
        g = g - insulin * k["glucose_insulin_per_unit"] + dextrose * k["glucose_dextrose_per_unit"]
        return max(2.0, round(g, 1))

    def glucose_abnormal(self, mmol: float) -> bool:
        return mmol < self._thr("glucose_lo") or mmol > self._thr("glucose_hi")

    def breath(self, values: dict, physio: dict) -> str:
        """Lung auscultation: clear / crackles / wheeze / diminished.

        Crackles (pulmonary edema) scale with volume overload; wheeze with an
        airway axis; diminished with the disease axis. Salbutamol opens the
        airways.
        """
        c = self._c
        sev = self.bleeding(values)
        vol = physio.get("vol", 1.0)
        if c.get("breath_crackle_vol", 0.0) and vol >= c["breath_crackle_vol"]:
            return "crackles"
        if active_meds(physio).get("SALBUTAMOL", {}).get("plasma", 0.0) > 0.05:
            return "wheeze" if c.get("breath_axis_gain", 0.0) * sev > 0.3 else "clear"
        if c.get("breath_axis_gain", 0.0) * sev > 0.5:
            return "diminished"
        return "clear"

    def breath_abnormal(self, sound: str) -> bool:
        return sound != "clear"

    def consciousness(self, values: dict, physio: dict) -> float:
        return physio.get("conscious", 1.0)

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
            glucose=self.glucose,
            glucose_abnormal=self.glucose_abnormal,
            breath=self.breath,
            breath_abnormal=self.breath_abnormal,
            consciousness=self.consciousness,
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
    "ASSESS_GLUCOSE": 1,
    "ASSESS_BREATH": 2,
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
    coupling: dict,
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
    drug_keys: tuple[str, ...] = ("FLUIDS", "TRANSFUSE", "MORPHINE", "OXYGEN"),
    assess_targets: dict[str, str] | None = None,
    start_clock: str = "08:30",  # 分片化：病例起始时间片（早班/夜班/ICU）
) -> CaseSpec:
    """One playable case = initial condition + axis coupling on the SHARED kernel."""
    durations = {**_DURATIONS_BASE, **(extra_durations or {})}
    assessments = assess_targets or {"vitals": "生命体征", "drain": "引流", "pain": "疼痛", "urine": "尿量"}
    surface = SurfaceSpec(
        assessments=assessments,
        drugs={k: DRUGS[k].label for k in drug_keys},
    )
    return CaseSpec(
        name=name,
        version=case_id,
        start_clock=start_clock,  # game minute 0 == start_clock
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
            intervention_costs={k: DRUGS[k].cost for k in surface.drugs},
            durations=durations,
            lab_kinds=_make_lab_kinds(axis, coupling, _KERNEL),
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
        physiology=InternalMedicineKernel(axis, coupling).spec(),
        surface=surface,
    )


# ── Case registry ─────────────────────────────────────────────────────────
# Each case is: initial condition (start_severity) + axis coupling table.
# The kernel equations are universal — cases only say how their axis moves
# the shared compartments.

# MVP-B: 腹部术后隐匿性出血 —— bleeding axis drains volume & hemoglobin.
_BLEEDING_COUPLING = {
    "vol_axis_rate": 0.35,  # volume fraction lost per unit severity
    "hb_axis_rate": 180.0,  # g/L Hb fall per unit severity
    "svr_axis_dilate": 0.0,  # bleeding does not dilate vessels
    "lac_axis_gain": 0.0,
    "hr_axis_gain": 0.0,
    "temp_axis_gain": 0.0,
    "wbc_axis_gain": 2.0,
    "drain_axis_gain": 180,
    "pain_axis_gain": 8,
}

CASE = _build_case(
    case_id="mvpb-1",
    name="腹部术后隐匿性出血（MVP-B）",
    patient="王秀兰，58 岁女性，昨日胃癌根治术后，术后第 1 日，术后予低分子肝素预防 VTE",
    axis="bleeding",
    coupling=_BLEEDING_COUPLING,
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
    drug_keys=("FLUIDS", "TRANSFUSE", "MORPHINE", "NSAID", "OXYGEN", "DIURETIC", "VASOPRESSOR"),
)

# MVP-I: 腹部术后腹腔感染 —— infection axis: fever + vasodilation + leukocytosis.
_INFECTION_COUPLING = {
    "vol_axis_rate": 0.20,  # sepsis vasodilation → relative hypovolemia
    "hb_axis_rate": 0.0,  # infection does not drain Hb
    "svr_axis_dilate": 0.8,  # vasodilation lowers resistance
    "lac_axis_gain": 0.4,  # sepsis drives lactate
    "hr_axis_gain": 30,  # fever tachycardia
    "temp_axis_gain": 2.0,  # fever: T = 37 + 2*sev
    "wbc_axis_gain": 12.0,  # leukocytosis
    "wbc_abn": 11.0,  # infection: WBC crosses the abnormal bar sooner
    "drain_axis_gain": 40,  # 引流液浑浊增多
    "pain_axis_gain": 5,
}

CASE_INFECTION = _build_case(
    case_id="mvpi-1",
    name="腹部术后腹腔感染（MVP-I）",
    patient="刘国栋，64 岁男性，昨日胃大部切除术后，术后第 1 日，发热伴腹痛",
    axis="infection",
    coupling=_INFECTION_COUPLING,
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
    # Infection specialty stocks antibiotics instead of transfusion.
    drug_keys=("FLUIDS", "MORPHINE", "OXYGEN", "ANTIBIOTIC"),
)

# MVP-D: 糖尿病酮症酸中毒 —— glucose axis: hyperglycemia + dehydration + acidosis.
_DKA_COUPLING = {
    "vol_axis_rate": 0.25,  # osmotic diuresis → volume depletion
    "hb_axis_rate": 0.0,
    "svr_axis_dilate": 0.3,
    "lac_axis_gain": 0.6,  # ketoacidosis drives lactate
    "hr_axis_gain": 25,
    "temp_axis_gain": 0.0,
    "wbc_axis_gain": 0.0,
    "glucose_axis_gain": 12.0,  # glucose 5.5 + 12*sev mmol/L
    "glucose_hi": 11.1,
    "pain_axis_gain": 3,
    "conscious_axis_gain": 0.4,  # hyperglycemia/acidosis cloud consciousness
}

CASE_DKA = _build_case(
    case_id="mvpd-1",
    name="糖尿病酮症酸中毒（MVP-D）",
    patient="陈秀芳，52 岁女性，2 型糖尿病史 10 年，近日停用胰岛素，恶心呕吐、烦渴多尿",
    axis="glucose",
    coupling=_DKA_COUPLING,
    start_severity=0.25,
    step=0.06,
    mid_severity=0.55,  # 血糖 ~12.1 mmol/L
    deterioration_severity=0.75,
    failure_severity=1.0,
    diag_hint="疑诊糖尿病酮症酸中毒",
    handover_task="识别并有效报告糖尿病酮症酸中毒（高血糖 + 脱水 + 酸中毒）",
    goal="评估→检查→报告，识别并报告 DKA，纠正脱水与高血糖，患者出院。",
    monitor_alert="血糖升高伴心率增快，警惕 DKA 加重。",
    deterioration="意识模糊、深大呼吸（Kussmaul），酸中毒加重。需立即处理。",
    failure="酮症酸中毒昏迷未被及时识别与控制——病例失败。",
    discharge="血糖控制良好，脱水与酸中毒纠正，予以出院。较好结局达成。",
    verdict_failure="判定：延误/漏诊——未及时获得异常证据并有效报告，DKA 进展至昏迷。",
    verdict_delayed="判定：迟报成功——在病情明显恶化后才报告，处置及时但发现偏晚。",
    verdict_timely="判定：及时——在病情明显恶化前获得异常证据并有效报告，患者顺利出院。",
    assess_targets={"vitals": "生命体征", "pain": "疼痛", "urine": "尿量", "glucose": "血糖", "breath": "肺部听诊"},
    drug_keys=("FLUIDS", "INSULIN", "GLUCOSE", "MORPHINE", "OXYGEN"),
    start_clock="22:00",  # 急诊夜班
)

# MVP-H: 急性失代偿性心力衰竭 —— volume axis: congestion + pulmonary edema.
_CHF_COUPLING = {
    "vol_axis_rate": -0.30,  # congestion RAISES volume (fluid retention)
    "hb_axis_rate": 0.0,
    "svr_axis_dilate": 0.2,
    "lac_axis_gain": 0.3,
    "hr_axis_gain": 35,  # tachycardic decompensation
    "temp_axis_gain": 0.0,
    "wbc_axis_gain": 0.0,
    "breath_crackle_vol": 0.85,  # volume overload → crackles
    "breath_axis_gain": 0.4,
    "pain_axis_gain": 0,
    "conscious_axis_gain": 0.2,
}

CASE_CHF = _build_case(
    case_id="mvph-1",
    name="急性失代偿性心力衰竭（MVP-H）",
    patient="赵德发，68 岁男性，冠心病史，近 3 日进行性气促、夜间不能平卧、下肢水肿",
    axis="volume",
    coupling=_CHF_COUPLING,
    start_severity=0.30,
    step=0.05,
    mid_severity=0.60,  # vol 1.18 → crackles
    deterioration_severity=0.80,
    failure_severity=1.0,
    diag_hint="疑诊急性心衰",
    handover_task="识别并有效报告急性失代偿性心力衰竭（容量超负荷 + 肺水肿）",
    goal="评估→检查→报告，识别并报告急性心衰，利尿减容，患者出院。",
    monitor_alert="血氧下降、呼吸急促，警惕肺水肿加重。",
    deterioration="端坐呼吸、双肺湿啰音弥漫，低氧血症。需立即处理。",
    failure="心源性休克/呼吸衰竭未被及时识别与控制——病例失败。",
    discharge="容量控制良好，呼吸困难缓解，予以出院。较好结局达成。",
    verdict_failure="判定：延误/漏诊——未及时获得异常证据并有效报告，心衰进展至呼吸衰竭。",
    verdict_delayed="判定：迟报成功——在病情明显恶化后才报告，处置及时但发现偏晚。",
    verdict_timely="判定：及时——在病情明显恶化前获得异常证据并有效报告，患者顺利出院。",
    assess_targets={"vitals": "生命体征", "pain": "疼痛", "urine": "尿量", "breath": "肺部听诊", "glucose": "血糖"},
    drug_keys=("DIURETIC", "OXYGEN", "MORPHINE", "FLUIDS", "VASOPRESSOR"),
    start_clock="02:00",  # ICU 凌晨
)


# ── Derived aliases (single source of truth is CASE) ──
CASE_NAME = CASE.name
CASE_VERSION = CASE.version
CASE_START_CLOCK = CASE.start_clock
PATIENT_DESC = CASE.patient

# ── Case registry (explicit, no runtime discovery) ──
CASES: dict[str, CaseSpec] = {
    "mvpb-1": CASE,
    "mvpi-1": CASE_INFECTION,
    "mvpd-1": CASE_DKA,
    "mvph-1": CASE_CHF,
}


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


def _clock_offset(start_clock: str) -> int:
    """起始时钟（如 "22:00"）→ 距 00:00 的分钟数。分片化：每个病例有
    自己的起始时间片（早班/夜班/ICU），模拟分钟映射到该病例的时钟。"""
    hh, mm = (int(x) for x in start_clock.split(":"))
    return hh * 60 + mm


def clock_text(minute: int, start_clock: str = "08:30") -> str:
    """模拟分钟 → 病例起始时钟上的墙钟时间（默认早班 08:30 兼容）。"""
    total = _clock_offset(start_clock) + minute
    hh = (total // 60) % 24
    mm = total % 60
    return f"{hh:02d}:{mm:02d}"
