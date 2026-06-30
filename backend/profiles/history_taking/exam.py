"""操作处理器 — 配置驱动的查体/测量操作

从 case_data.exam_anchors 读取配置，支持两种格式：
1. 新格式：含 groups 结构（前端直接消费）
2. 旧格式：自动从 vital_signs/skin/pain_score 推导
"""

import logging

log = logging.getLogger(__name__)

_LEGACY_OP_DEFS: dict[str, dict] = {
    "temp": {"label": "体温", "unit": "°C", "source": ("vital_signs", "temperature")},
    "hr": {"label": "心率", "unit": "次/分", "source": ("vital_signs", "heart_rate")},
    "bp": {"label": "血压", "unit": "mmHg", "source": ("vital_signs", "blood_pressure")},
    "rr": {"label": "呼吸频率", "unit": "次/分", "source": ("vital_signs", "respiratory_rate")},
    "spo2": {"label": "血氧饱和度", "unit": "%", "source": ("vital_signs", "spo2")},
    "skin": {"label": "皮肤", "unit": "", "source": ("skin",)},
    "pain": {"label": "NRS疼痛评分", "unit": "/10", "source": ("pain_score",)},
}

_LEGACY_VITAL_OPS = ["temp", "hr", "bp", "rr", "spo2"]
_LEGACY_INSPECT_OPS = ["skin", "pain"]


def get_exam_config(case_data: dict) -> dict | None:
    anchors = case_data.get("exam_anchors", {})
    if not anchors:
        return None
    if "groups" in anchors:
        return anchors
    return _build_legacy_config(anchors)


def handle_operation(op_type: str, case_data: dict) -> dict:
    anchors = case_data.get("exam_anchors", {})
    if not anchors:
        return {"type": "info", "label": "查体", "value": "该病例未配置查体数据", "unit": ""}

    op_defs = _collect_op_defs(anchors)
    op_def = op_defs.get(op_type)
    if not op_def:
        return {"type": "error", "label": "未知操作", "value": f"不支持的操作: {op_type}", "unit": ""}

    value = _resolve_value(op_type, op_def, anchors, case_data)
    return {
        "type": op_type if op_type == "vitals" else ("vitals" if op_type in _LEGACY_VITAL_OPS else "exam"),
        "label": op_def["label"],
        "value": value,
        "unit": op_def["unit"],
    }


# ── Config 构建 ──


def _build_legacy_config(anchors: dict) -> dict:
    op_ids = _detect_ops(anchors)
    groups = []
    vital_ids = [oid for oid in _LEGACY_VITAL_OPS if oid in op_ids]
    if vital_ids:
        groups.append(
            {
                "id": "vitals",
                "label": "生命体征",
                "icon": "Heart",
                "ops": [
                    {"id": oid, "label": _LEGACY_OP_DEFS[oid]["label"], "unit": _LEGACY_OP_DEFS[oid]["unit"]}
                    for oid in vital_ids
                ],
            }
        )
    inspect_ids = [oid for oid in op_ids if oid in _LEGACY_INSPECT_OPS]
    if inspect_ids:
        groups.append(
            {
                "id": "inspection",
                "label": "体格检查",
                "icon": "Stethoscope",
                "ops": [
                    {"id": oid, "label": _LEGACY_OP_DEFS[oid]["label"], "unit": _LEGACY_OP_DEFS[oid]["unit"]}
                    for oid in inspect_ids
                ],
            }
        )
    return {"groups": groups}


def _detect_ops(anchors: dict) -> list[str]:
    ops = set()
    vs = anchors.get("vital_signs", {})
    if any(vs.get(k) for k in ("temperature", "heart_rate", "blood_pressure", "respiratory_rate", "spo2")):
        ops.update(_LEGACY_VITAL_OPS)
    if anchors.get("skin"):
        ops.add("skin")
    if anchors.get("pain_score") is not None:
        ops.add("pain")
    return list(ops)


# ── 操作定义收集 ──


def _collect_op_defs(anchors: dict) -> dict[str, dict]:
    if "groups" in anchors:
        defs: dict[str, dict] = {}
        for group in anchors["groups"]:
            for op in group.get("ops", []):
                src = op.get("source", op["id"])
                defs[op["id"]] = {
                    "label": op["label"],
                    "unit": op.get("unit", ""),
                    "source": (src,),
                }
        return defs
    op_ids = _detect_ops(anchors)
    defs = {oid: _LEGACY_OP_DEFS[oid] for oid in op_ids if oid in _LEGACY_OP_DEFS}
    has_vitals = any(oid in _LEGACY_VITAL_OPS for oid in op_ids)
    if has_vitals:
        defs["vitals"] = {"label": "生命体征(汇总)", "unit": "", "source": ("_vitals",)}
    return defs


# ── 值解析 ──


def _resolve_value(op_type: str, op_def: dict, anchors: dict, case_data: dict) -> str:
    path = op_def["source"]

    if path[0] == "_vitals":
        vs = anchors.get("vital_signs", {})
        result = _format_vitals(vs)
        return result["value"]

    if path[0] == "vital_signs":
        vs = anchors.get("vital_signs", {})
        raw = vs.get(path[1], "") if len(path) > 1 else ""
        if not raw:
            return "—"
        return _resolve_range(str(raw))

    if path[0] == "skin":
        return anchors.get("skin", "") or "未见明显异常"

    if path[0] == "pain_score":
        nrs = case_data.get("pain_score", anchors.get("pain_score"))
        if nrs is not None:
            return str(nrs)
        return "患者可自主报告"

    return "—"


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
            val = (lo + hi) / 2
            return f"{val:.1f}"
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


# ── 旧版兼容导出 ──


def _format_vitals(vs: dict) -> dict:
    lines = []
    mappings = [
        ("体温", "temperature", "°C"),
        ("心率", "heart_rate", "次/分"),
        ("血压", "blood_pressure", "mmHg"),
        ("呼吸", "respiratory_rate", "次/分"),
        ("SpO2", "spo2", "%"),
    ]
    for label, key, unit in mappings:
        val = vs.get(key, "")
        if not val:
            continue
        if key == "blood_pressure" and "-" in str(val):
            parsed = _resolve_range(str(val))
            lines.append(f"{label}: {parsed}")
        elif "-" in str(val):
            resolved = _resolve_range(str(val))
            lines.append(f"{label}: {resolved}")
        else:
            lines.append(f"{label}: {val}")
    value = "\n".join(lines) if lines else "未配置"
    return {"type": "vitals", "label": "生命体征", "value": value, "unit": ""}


def _parse_pain(case_data: dict) -> dict:
    nrs = case_data.get("pain_score")
    if nrs is not None:
        return {"type": "vitals", "label": "NRS疼痛评分", "value": str(nrs), "unit": "/10"}
    return {"type": "vitals", "label": "NRS疼痛评分", "value": "患者可自主报告"}


_KNOWN_VITALS = {"temp", "bp", "hr", "rr", "spo2", "skin", "pain"}


def infer_operations(case_data: dict) -> list[str]:
    ops = ["chat"]
    physiology = case_data.get("physiology", {})
    if physiology.get("timeline"):
        baseline = (
            physiology["timeline"]["0m"]
            if "0m" in physiology["timeline"]
            else next(iter(physiology["timeline"].values()))
        )
        for k in baseline:
            if k in _KNOWN_VITALS:
                ops.append(k)
    if not ops and case_data.get("exam_anchors"):
        ops.extend(["vitals", "bp", "temp", "spo2", "hr", "rr", "skin", "pain"])
    return ops
