"""操作处理器 — 查体/测量操作的关键词绑定与锚点数据查找

学生输入斜杆指令 (/bp, /vitals) 或触发关键词时，
从病例 exam_anchors 返回系统数据。
"""

import logging
import random

log = logging.getLogger(__name__)

OPERATION_ALIASES = {
    "vitals": ["/vitals", "/生命体征", "/查体征", "测生命体征", "查生命体征", "测量生命体征"],
    "bp": ["/bp", "/血压", "测血压", "量血压", "测量血压"],
    "temp": ["/temp", "/体温", "测体温", "量体温", "测量体温"],
    "spo2": ["/spo2", "/血氧", "测血氧", "查血氧"],
    "hr": ["/hr", "/心率", "/脉搏", "测心率", "测脉搏"],
    "rr": ["/rr", "/呼吸", "测呼吸", "数呼吸频率"],
    "skin": ["/skin", "/皮肤", "看皮肤", "检查皮肤", "观察皮肤"],
    "pain": ["/pain", "/疼痛评分", "/nrs", "疼痛评分", "疼痛评估"],
}


def detect_operation(content: str) -> str | None:
    """检测学生输入是否触发了操作。返回操作类型或 None。"""
    content_lower = content.lower()
    for op_type, aliases in OPERATION_ALIASES.items():
        for alias in aliases:
            if alias in content_lower:
                return op_type
    return None


def handle_operation(op_type: str, case_data: dict) -> dict:
    """执行操作，返回系统数据响应。

    返回格式: {type, label, value, unit, note}
    """
    anchors = case_data.get("exam_anchors", {})
    exam_mapping = {
        "vitals": lambda a: _format_vitals(a.get("vital_signs", {})),
        "bp": lambda a: _parse_range(a.get("vital_signs", {}), "blood_pressure", "mmHg", "血压"),
        "temp": lambda a: _parse_range(a.get("vital_signs", {}), "temperature", "°C", "体温"),
        "spo2": lambda a: _parse_range(a.get("vital_signs", {}), "spo2", "%", "血氧饱和度"),
        "hr": lambda a: _parse_range(a.get("vital_signs", {}), "heart_rate", "次/分", "心率"),
        "rr": lambda a: _parse_range(a.get("vital_signs", {}), "respiratory_rate", "次/分", "呼吸频率"),
        "skin": lambda a: {"type": "exam", "label": "皮肤", "value": a.get("skin", "未见明显异常")},
        "pain": lambda a: _parse_pain(case_data),
    }

    handler = exam_mapping.get(op_type)
    if not handler:
        return {"type": "error", "label": "未知操作", "value": f"不支持的操作类型: {op_type}"}

    result = handler(anchors) if anchors else {"type": "info", "label": op_type, "value": "该病例未配置查体数据"}
    result["type"] = result.get("type", "vitals")
    return result


def _parse_range(data: dict, key: str, unit: str, label: str) -> dict:
    """从锚点范围中随机取一个值。支持'92-95%'、'92-95'、血压'138/86-146/92'格式。"""
    raw = data.get(key, "")
    if not raw:
        return {"type": "vitals", "label": label, "value": "—", "unit": unit}

    raw = str(raw).replace("%", "").strip()
    if "-" in raw:
        parts = raw.split("-")
        try:
            lo, hi = float(parts[0]), float(parts[1])
            val = round(random.uniform(lo, hi), 1)
        except (ValueError, IndexError):
            val = _try_parse_bp_range(raw)
        return {"type": "vitals", "label": label, "value": str(val), "unit": unit}

    return {"type": "vitals", "label": label, "value": raw, "unit": unit}


def _try_parse_bp_range(raw: str) -> str:
    """解析血压区间格式 '138/86-146/92' → 随机取一个测量值如 '141/88'。"""
    if "/" not in raw:
        return raw
    try:
        left, right = raw.split("-")
        s_lo, d_lo = left.split("/")
        s_hi, d_hi = right.split("/")
        s_val = round(random.uniform(float(s_lo), float(s_hi)))
        d_val = round(random.uniform(float(d_lo), float(d_hi)))
        return f"{int(s_val)}/{int(d_val)}"
    except (ValueError, IndexError):
        return raw


def _format_vitals(vs: dict) -> dict:
    """汇总生命体征"""
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
            parsed = _try_parse_bp_range(str(val))
            lines.append(f"{label}: {parsed}")
        elif key in ("temperature", "heart_rate", "respiratory_rate", "spo2") and "-" in str(val):
            result = _parse_range(vs, key, unit, label)
            lines.append(f"{label}: {result['value']}")
        else:
            lines.append(f"{label}: {val}")
    value = "\n".join(lines) if lines else "未配置"
    return {"type": "vitals", "label": "生命体征", "value": value, "unit": ""}


def _parse_pain(case_data: dict) -> dict:
    nrs = case_data.get("pain_score")
    if nrs is not None:
        return {"type": "vitals", "label": "NRS疼痛评分", "value": str(nrs), "unit": "/10"}
    return {"type": "vitals", "label": "NRS疼痛评分", "value": "患者可自主报告"}
