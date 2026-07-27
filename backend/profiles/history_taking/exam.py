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

    value = _resolve_value(op_type, op_def, anchors, case_data)
    category = "vitals" if op_type in _VITAL_OPS else "exam"
    return {
        "type": category,
        "label": op_def["label"],
        "value": value,
        "unit": op_def["unit"],
    }


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
