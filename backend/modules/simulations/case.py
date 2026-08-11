"""The single MVP-B clinical case: hidden post-op bleeding on day 1.

All values here are deterministic engineering numbers chosen so the three
MVP demo scenarios and the automated tests behave as specified. Medical
plausibility is intentionally tunable (see delivery notes); the brief only
defines engineering behaviour, and no DSL is built — the case is plain Python.
"""

CASE_NAME = "腹部术后隐匿性出血（MVP-B）"
CASE_VERSION = "mvpb-1"
CASE_START_CLOCK = "08:30"  # game minute 0 == 08:30

# ── Hidden disease course ──
SEVERITY_START = 0.12
SEVERITY_STEP = 0.06
BLEEDING_INTERVAL_MIN = 6

# Severity thresholds (0..1)
VITALS_MID_SEVERITY = 0.34  # HR>=95 / SBP<=108; also the MONITOR_ALERT trigger
DETERIORATION_SEVERITY = 0.60
FAILURE_SEVERITY = 1.0

# ── CBC ──
CBC_TURNAROUND_MIN = 15
CBC_COST_YUAN = 35

# ── Active action durations (minutes) ──
DURATION_MIN = {
    "ASSESS_VITALS": 2,
    "ASSESS_DRAIN": 3,
    "ORDER_CBC": 3,
    "MONITOR": 2,
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


def hb_for(severity: float) -> float:
    return 145 - 180 * severity


def hb_abnormal(hb: float) -> bool:
    return hb < 115


def wbc_for(severity: float) -> float:
    return round(8.5 + 2 * severity, 1)


def clock_text(minute: int) -> str:
    total = 8 * 60 + 30 + minute
    hh = (total // 60) % 24
    mm = total % 60
    return f"{hh:02d}:{mm:02d}"
