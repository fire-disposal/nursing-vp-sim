"""操作处理器 — 配置驱动的查体/测量操作

从 case_data.tools.physical_exam 读取配置（向后兼容 case_data.exam_anchors）。
支持两种格式：
1. 新格式：含 groups 结构（前端直接消费）
2. 旧格式：自动从 vital_signs/skin/pain_score 推导

当未配置某项测量时，根据患者年龄返回临床合理默认值。
"""

from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger(__name__)
# ── 操作定义表（所有标准操作始终可用，未配置时回落默认值）──────────

_LEGACY_OP_DEFS: dict[str, dict] = {
    "temp": {"label": "体温", "unit": "°C", "source": ("vital_signs", "temperature")},
    "hr": {"label": "心率", "unit": "次/分", "source": ("vital_signs", "heart_rate")},
    "bp": {"label": "血压", "unit": "mmHg", "source": ("vital_signs", "blood_pressure")},
    "rr": {"label": "呼吸频率", "unit": "次/分", "source": ("vital_signs", "respiratory_rate")},
    "spo2": {"label": "血氧饱和度", "unit": "%", "source": ("vital_signs", "spo2")},
    "skin": {"label": "皮肤检查", "unit": "", "source": ("skin",)},
    "pain": {"label": "NRS疼痛评分", "unit": "/10", "source": ("pain_score",)},
}

_VITAL_OPS = frozenset({"temp", "hr", "bp", "rr", "spo2"})

# ── 年龄自适应默认值（range 格式，前端显示时解析为中值）────────────

_AGE_DEFAULTS: dict[str, dict[str, str]] = {
    "pediatric": {
        "temperature": "36.5-37.5",
        "heart_rate": "80-120",
        "blood_pressure": "90/55-110/70",
        "respiratory_rate": "20-30",
        "spo2": "95-100",
    },
    "adult": {
        "temperature": "36.3-37.2",
        "heart_rate": "60-100",
        "blood_pressure": "110/70-130/85",
        "respiratory_rate": "12-20",
        "spo2": "95-100",
    },
    "elderly": {
        "temperature": "36.0-37.0",
        "heart_rate": "60-100",
        "blood_pressure": "120/70-145/90",
        "respiratory_rate": "12-22",
        "spo2": "93-100",
    },
}

_INSPECTION_DEFAULTS: dict[str, str] = {
    "head": "头颅无畸形，面部对称",
    "chest": "胸廓对称，无畸形",
    "abdomen": "腹部平坦，无压痛、反跳痛、肌紧张",
    "skin": "皮肤温暖干燥，未见皮疹、破损或异常色素沉着",
    "extremity": "四肢活动自如，无水肿、畸形或静脉曲张",
}


def _get_age_group(case_data: dict) -> str:
    info = case_data.get("patient_info") or {}
    age = info.get("age", 0)
    if not isinstance(age, (int, float)):
        age = 0
    if age <= 0:
        return "adult"  # unknown age → default to adult
    if age <= 12:
        return "pediatric"
    if age >= 65:
        return "elderly"
    return "adult"


# ── 生理联动网络（TRAINING-ARCH-MEMO 前瞻的最小实现）───────────────
# 游戏级内部一致性，非科研精度：确定性纯函数，只对「未配置」的体征
# 按其他已配置体征的偏离做代偿偏移；作者显式配置的体征始终被尊重。
#   发热（temp > 参考上限）     → HR ↑（每超 1°C 约 +12 次/分）
#   低血压（收缩压 < 参考下限） → HR ↑（代偿性心动过速）
#   低血氧（SpO₂ < 95%）        → RR ↑（呼吸代偿）
#   剧痛（NRS ≥ 7）            → HR ↑、BP ↑（应激反应）

_VITAL_ORDER = ("temp", "hr", "bp", "rr", "spo2", "pain")

_VITAL_NORM_KEY = {
    "temp": "temperature",
    "hr": "heart_rate",
    "rr": "respiratory_rate",
    "spo2": "spo2",
}


# ── 生理联动网络 ────────────────────────────────────────────────────


def _parse_num(raw: Any) -> float | None:
    """Parse a numeric string; returns None for garbage."""
    import math

    try:
        v = float(str(raw).strip())
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v):
        return None
    return v


def _parse_bp_pair(raw: Any) -> tuple[int, int] | None:
    """Parse '120/78' (or midpoint-resolved '125/83') → (sys, dia)."""
    try:
        s, d = str(raw).split("/", 1)
        return round(float(s)), round(float(d))
    except (TypeError, ValueError):
        return None


def _split_bounds(range_str: str) -> tuple[float, float]:
    """'36.3-37.2' → (36.3, 37.2)."""
    lo, hi = range_str.split("-", 1)
    return float(lo), float(hi)


def _bp_bounds(range_str: str) -> tuple[float, float, float, float]:
    """'110/70-130/85' → (sys_lo, dia_lo, sys_hi, dia_hi)."""
    left, right = range_str.split("-", 1)
    s_lo, d_lo = left.split("/")
    s_hi, d_hi = right.split("/")
    return float(s_lo), float(d_lo), float(s_hi), float(d_hi)


def _compute_link_offsets(configured: dict[str, str], group: str) -> dict[str, float]:
    """按已配置体征的偏离计算代偿偏移量（纯函数，确定性）。"""
    offsets = {"hr": 0.0, "rr": 0.0, "bp_sys": 0.0, "bp_dia": 0.0}
    norms = _AGE_DEFAULTS[group]

    temp = _parse_num(configured.get("temp"))
    if temp is not None:
        _lo, hi = _split_bounds(norms["temperature"])
        if temp > hi:
            offsets["hr"] += round((temp - hi) * 12)

    spo2 = _parse_num(configured.get("spo2"))
    if spo2 is not None and spo2 < 95:
        offsets["rr"] += round(95 - spo2)

    bp = _parse_bp_pair(configured.get("bp"))
    if bp is not None:
        sys, _dia = bp
        sys_lo, _d_lo, _s_hi, _d_hi = _bp_bounds(norms["blood_pressure"])
        if sys < sys_lo:
            offsets["hr"] += 15 if sys >= sys_lo - 10 else 25

    pain = _parse_num(configured.get("pain"))
    if pain is not None and pain >= 7:
        offsets["hr"] += 10
        offsets["bp_sys"] += 8
        offsets["bp_dia"] += 4

    return offsets


def _apply_offsets(op_type: str, base: str, offsets: dict[str, float]) -> str:
    """把代偿偏移应用到年龄默认值上（仅未配置的体征走这里）。"""
    if op_type == "hr":
        v = _parse_num(base)
        return str(round((v or 0) + offsets["hr"])) if v is not None else base
    if op_type == "rr":
        v = _parse_num(base)
        return str(round((v or 0) + offsets["rr"])) if v is not None else base
    if op_type == "bp":
        pair = _parse_bp_pair(base)
        if pair:
            sys, dia = pair
            return f"{round(sys + offsets['bp_sys'])}/{round(dia + offsets['bp_dia'])}"
        return base
    return base


def _resolve_physiology(case_data: dict) -> dict[str, str]:
    """解析全部体征：已配置的尊重原值，未配置的取年龄默认值并叠加代偿偏移。"""
    tools = case_data.get("tools", {}) if isinstance(case_data, dict) else {}
    anchors = (
        tools.get("physical_exam")
        if isinstance(tools.get("physical_exam"), dict)
        else case_data.get("exam_anchors", {})
    )
    op_defs = _collect_op_defs(anchors)
    group = _get_age_group(case_data)

    configured: dict[str, str] = {}
    for op_type in _VITAL_ORDER:
        op_def = op_defs.get(op_type)
        if not op_def:
            continue
        val = _try_from_config(tuple(op_def.get("source", ())), anchors, case_data)
        if val is not None:
            configured[op_type] = val

    offsets = _compute_link_offsets(configured, group)

    result: dict[str, str] = {}
    for op_type in _VITAL_ORDER:
        if op_type in configured:
            result[op_type] = configured[op_type]
        else:
            result[op_type] = _apply_offsets(op_type, _get_default(op_type, case_data), offsets)
    return result


# ── 解读提示（引导模式展示；考核模式由前端门控隐藏） ──────────────


def _interpret_measurement(op_type: str, value: str, label: str, case_data: dict) -> dict | None:
    """生成查体结果的对照解读：status + 一句非答案式教学文案。"""
    if op_type not in _VITAL_OPS:
        return None
    group = _get_age_group(case_data)
    norms = _AGE_DEFAULTS[group]

    if op_type == "bp":
        pair = _parse_bp_pair(value)
        if pair is None:
            return None
        sys, dia = pair
        s_lo, d_lo, s_hi, d_hi = _bp_bounds(norms["blood_pressure"])
        if sys > s_hi or dia > d_hi:
            status = "high"
            text = f"{label} {value} mmHg，高于参考范围（{s_lo:.0f}-{s_hi:.0f}/{d_lo:.0f}-{d_hi:.0f}）"
        elif sys < s_lo or dia < d_lo:
            status = "low"
            text = f"{label} {value} mmHg，低于参考范围（{s_lo:.0f}-{s_hi:.0f}/{d_lo:.0f}-{d_hi:.0f}）"
        else:
            status = "normal"
            text = f"{label} {value} mmHg，在参考范围内"
        return {"status": status, "text": text}

    v = _parse_num(value)
    if v is None:
        return None
    lo, hi = _split_bounds(norms[_VITAL_NORM_KEY[op_type]])
    unit = _LEGACY_OP_DEFS[op_type]["unit"]
    if v > hi:
        status = "high"
        text = f"{label} {value}{unit}，高于参考范围（{lo:.1f}-{hi:.1f}{unit}）"
    elif v < lo:
        status = "low"
        text = f"{label} {value}{unit}，低于参考范围（{lo:.1f}-{hi:.1f}{unit}）"
    else:
        status = "normal"
        text = f"{label} {value}{unit}，在参考范围（{lo:.1f}-{hi:.1f}{unit}）内"
    return {"status": status, "text": text}


# ── 公共入口 ────────────────────────────────────────────────────────────


def handle_operation(op_type: str, case_data: dict) -> dict:
    """执行一项查体/测量操作。

    所有标准操作始终可用：优先从 exam_anchors 读取配置值，缺失时
    根据患者年龄返回临床合理默认值。
    """
    tools = case_data.get("tools", {}) if isinstance(case_data, dict) else {}
    anchors = (
        tools.get("physical_exam")
        if isinstance(tools.get("physical_exam"), dict)
        else case_data.get("exam_anchors", {})
    )
    op_defs = _collect_op_defs(anchors)
    op_def = op_defs.get(op_type)
    if not op_def:
        return {"type": "error", "label": "未知操作", "value": f"不支持的操作: {op_type}", "unit": ""}

    if op_type in _VITAL_OPS or op_type == "pain":
        value = _resolve_physiology(case_data).get(op_type, "—")
    else:
        value = _resolve_value(op_type, op_def, anchors, case_data)

    category = "vitals" if op_type in _VITAL_OPS else "exam"
    result = {
        "type": category,
        "label": op_def["label"],
        "value": value,
        "unit": op_def["unit"],
    }
    interpretation = _interpret_measurement(op_type, value, op_def["label"], case_data)
    if interpretation:
        result["interpretation"] = interpretation
    return result


# ── 操作定义收集 ────────────────────────────────────────────────────────


def _collect_op_defs(anchors: dict) -> dict[str, dict]:
    if isinstance(anchors.get("groups"), list) and anchors["groups"]:
        defs: dict[str, dict] = {}
        for group in anchors["groups"]:
            for op in group.get("ops", []):
                src_raw = op.get("source", op.get("id", ""))
                src_parts = tuple(src_raw.split(".")) if src_raw else (op.get("id", ""),)
                defs[op["id"]] = {
                    "label": op.get("label", op["id"]),
                    "unit": op.get("unit", ""),
                    "source": src_parts,
                }
        return defs

    # Legacy format: always include all standard ops; resolve per-op below.
    return dict(_LEGACY_OP_DEFS)


# ── 值解析 + 默认值回落 ─────────────────────────────────────────────────


def _resolve_value(op_type: str, op_def: dict, anchors: dict, case_data: dict) -> str:
    path: tuple[str, ...] = op_def.get("source", ())

    configured = _try_from_config(path, anchors, case_data)
    if configured is not None:
        return configured

    # Fallback: age-appropriate default
    return _get_default(op_type, case_data)


def _try_from_config(path: tuple[str, ...], anchors: dict, case_data: dict) -> str | None:
    """Try to resolve from exam_anchors. Returns None if not configured."""
    if not path:
        return None

    root = path[0]

    if root == "vital_signs":
        vs = anchors.get("vital_signs", {}) if isinstance(anchors, dict) else {}
        key = path[1] if len(path) > 1 else ""
        raw = vs.get(key, "") if isinstance(vs, dict) else ""
        if raw:
            return _resolve_range(str(raw))
        return None

    if root == "skin":
        skin = anchors.get("skin") if isinstance(anchors, dict) else None
        return _format_skin(skin) if skin is not None else None

    if root == "pain_score":
        vs = anchors.get("vital_signs", {}) if isinstance(anchors, dict) else {}
        # Check top-level first, then vital_signs sub-key
        nrs = anchors.get("pain_score") if isinstance(anchors, dict) else None
        if nrs is None and isinstance(vs, dict):
            nrs = vs.get("pain_score")
        if nrs is not None:
            return str(nrs)
        return None

    return None


def _format_skin(skin_data: Any) -> str | None:
    """Format skin inspection data for display. Handles both flat string and nested dict."""
    if isinstance(skin_data, str):
        return skin_data
    if isinstance(skin_data, dict):
        for v in skin_data.values():
            if isinstance(v, str) and v.strip():
                return v.strip()
    return None


def _get_default(op_type: str, case_data: dict) -> str:
    """Return an age-appropriate default value for a measurement."""
    if op_type == "pain":
        return "0"

    if op_type == "skin":
        return _INSPECTION_DEFAULTS.get("skin", "未见明显异常")

    # Map frontend op_type → vital_signs key
    vital_key = {
        "temp": "temperature",
        "hr": "heart_rate",
        "bp": "blood_pressure",
        "rr": "respiratory_rate",
        "spo2": "spo2",
    }.get(op_type)

    if vital_key:
        group = _get_age_group(case_data)
        defaults = _AGE_DEFAULTS.get(group, _AGE_DEFAULTS["adult"])
        raw = defaults.get(vital_key, "")
        if raw:
            return _resolve_range(raw)

    return "—"


# ── Range 解析 ───────────────────────────────────────────────────────────


def _resolve_range(raw: str) -> str:
    """Resolve a config value to a single display string.

    - Range string ("36.5-37.2") → midpoint ("36.9")
    - BP range ("120/80-130/85") → midpoint ("125/83")
    - Fixed string ("36.8") → as‑is
    """
    raw = raw.strip()
    if "-" in raw and "/" in raw:
        return _resolve_bp(raw)
    if "-" in raw:
        parts = raw.split("-", 1)
        try:
            lo, hi = float(parts[0]), float(parts[1])
            return f"{(lo + hi) / 2:.1f}"
        except (ValueError, IndexError):
            pass
    return raw


def _resolve_bp(raw: str) -> str:
    """BP range → deterministic midpoint."""
    try:
        left, right = raw.split("-", 1)
        s_lo, d_lo = left.split("/")
        s_hi, d_hi = right.split("/")
        s = round((float(s_lo) + float(s_hi)) / 2)
        d = round((float(d_lo) + float(d_hi)) / 2)
        return f"{int(s)}/{int(d)}"
    except (ValueError, IndexError):
        return raw
