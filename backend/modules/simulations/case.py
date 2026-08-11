"""The single MVP-B clinical case: hidden post-op bleeding on day 1.

A nurse-station / doctor-facing simulation: the player can order a curated set
of labs and apply a curated set of interventions. All values are deterministic
engineering choices (medical plausibility tunable); no DSL — plain Python.
"""

from __future__ import annotations

from typing import TypedDict

CASE_NAME = "腹部术后隐匿性出血（MVP-B）"
CASE_VERSION = "mvpb-1"
CASE_START_CLOCK = "08:30"  # game minute 0 == 08:30


class _LabSpec(TypedDict):
    label: str
    cost: int
    turnaround: int


# ── Hidden disease course ──
SEVERITY_START = 0.12
SEVERITY_STEP = 0.06
BLEEDING_INTERVAL_MIN = 6

# Starting resource budget for ordering labs (¥). Lab orders deduct from it.
BUDGET_START = 300

# Severity thresholds (0..1)
VITALS_MID_SEVERITY = 0.34  # HR>=95 / SBP<=108; also the MONITOR_ALERT trigger
DETERIORATION_SEVERITY = 0.60
FAILURE_SEVERITY = 1.0

# Intervention effects on bleeding progression (multiplier on SEVERITY_STEP)
FLUID_PROGRESSION_MULT = 0.5  # transient, decays per tick
TRANSFUSE_PROGRESSION_MULT = 0.7  # sustained until report
FLUID_BP_MASK_PER_UNIT = 10  # mmHg hidden per support unit on manual vitals
ANALGESIA_PAIN_MASK = 2  # points hidden on pain assessment

# ── Orderable labs: label / cost (¥) / turnaround (min) ──
LAB_KINDS: dict[str, _LabSpec] = {
    "CBC": {"label": "血常规(CBC)", "cost": 35, "turnaround": 15},
    "ABG": {"label": "动脉血气(ABG)", "cost": 60, "turnaround": 10},
    "COAG": {"label": "凝血功能", "cost": 50, "turnaround": 20},
    "US": {"label": "腹部超声", "cost": 120, "turnaround": 20},
}

# ── Active action durations (minutes) ──
DURATION_MIN = {
    "ASSESS_VITALS": 2,
    "ASSESS_DRAIN": 3,
    "ASSESS_PAIN": 1,
    "ASSESS_URINE": 2,
    "ORDER_LAB": 3,
    "MONITOR": 2,
    "FLUIDS": 3,
    "TRANSFUSE": 5,
    "ANALGESIA": 1,
    "REPORT": 2,
}


def vitals(severity: float) -> dict:
    """Deterministic vital-signs snapshot for a given bleeding severity."""
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


def drain_output(severity: float) -> int:
    return 45 + round(180 * severity)


def drain_abnormal(output_ml: int) -> bool:
    return output_ml >= 80


def pain_score(severity: float) -> int:
    return min(10, 1 + round(8 * severity))


def pain_abnormal(score: int) -> bool:
    return score >= 4


def urine_output(severity: float) -> int:
    return max(20, 200 - round(180 * severity))


def urine_abnormal(output_ml: int) -> bool:
    return output_ml < 120


def hb_for(severity: float) -> float:
    return 145 - 180 * severity


def hb_abnormal(hb: float) -> bool:
    return hb < 115


def wbc_for(severity: float) -> float:
    return round(8.5 + 2 * severity, 1)


def materialize_lab(kind: str, sample_snapshot: dict, previous: dict | None) -> dict:
    """On-demand, one-shot materialization reflecting the sampled-time state.

    A lab is materialized only once (when its READY event fires) and only from
    the light snapshot saved at sampling time — never from result-return time.
    ``previous`` is the latest same-kind result, used for monotonic trends.
    """
    sev = sample_snapshot["severity"]
    if kind == "CBC":
        hb = hb_for(sev)
        if previous is not None and sev >= previous["sampled_severity"]:
            hb = min(hb, previous["hb"])
        return {
            "hb": round(hb, 1),
            "wbc": wbc_for(sev),
            "platelet": 220,
            "sampled_severity": round(sev, 4),
            "abnormal": hb_abnormal(hb),
        }
    if kind == "ABG":
        lactate = 0.8 + 6 * sev
        ph = 7.42 - 0.18 * sev
        return {
            "lactate": round(lactate, 2),
            "ph": round(ph, 2),
            "sampled_severity": round(sev, 4),
            "abnormal": lactate >= 2.0 or ph < 7.35,
        }
    if kind == "COAG":
        inr = 1.0 + 0.8 * sev
        return {
            "inr": round(inr, 2),
            "sampled_severity": round(sev, 4),
            "abnormal": inr > 1.2,
        }
    if kind == "US":
        free_fluid = sev >= 0.30
        return {
            "free_fluid": free_fluid,
            "sampled_severity": round(sev, 4),
            "abnormal": free_fluid,
        }
    raise ValueError(f"unknown lab kind: {kind}")


def lab_options_text() -> str:
    return "、".join(
        f"{LAB_KINDS[k]['label']}（¥{LAB_KINDS[k]['cost']}/{LAB_KINDS[k]['turnaround']}min）" for k in sorted(LAB_KINDS)
    )


def clock_text(minute: int) -> str:
    total = 8 * 60 + 30 + minute
    hh = (total // 60) % 24
    mm = total % 60
    return f"{hh:02d}:{mm:02d}"
