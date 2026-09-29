"""操作处理器 — 配置驱动的查体/测量操作

病例配置从 ``activities.physical_exam.config`` 读取。
支持两种格式：
1. 新格式：含 groups 结构（前端直接消费）
2. 旧格式：自动从 vital_signs/skin/pain_score 推导

当未配置某项测量时，根据患者年龄返回临床合理默认值。
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any

from core.exceptions import ValidationError

log = logging.getLogger(__name__)


def _activity_anchors(case_data: dict) -> dict:
    """病例为 ``physical_exam`` 声明的查体配置（未声明/形状不符 → 空配置）。

    函数内导入：``activities`` 装配 handler 时导入本模块，模块级反向导入会成环。
    """
    from modules.training.activities import activity_config

    config = activity_config(case_data, "physical_exam")
    return config if isinstance(config, dict) else {}


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

#: op_type → ``scene.vitals`` / ``VitalsState`` 的字段（血压是成对的两项）。
#: 读（本模块按当前状态取读数）与写（``physical_exam`` 把测量结果写回场景）共用同一份映射，
#: 两边各写一份就会再次分叉成"量到的值 ≠ 屏幕上的值"。
VITAL_KEYS_BY_OP: dict[str, tuple[str, ...]] = {
    "hr": ("hr",),
    "bp": ("bp_sys", "bp_dia"),
    "rr": ("rr",),
    "spo2": ("spo2",),
    "temp": ("temp",),
    "pain": ("pain",),
}

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
    #: 照护者代诉型病例（儿科）会把 ``patient_info.age`` 填成家长年龄，体征却是患儿的，
    #: 此时必须由病例显式声明参考人群，否则体征解读会套错成人范围。
    declared = str(info.get("vitals_age_group") or "").strip()
    if declared in _AGE_DEFAULTS:
        return declared
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


def _format_num(v: float) -> str:
    """体征值的显示形态：整数值不拖 ``.0``（与配置/默认值解析出的字符串同形）。"""
    return str(int(v)) if v.is_integer() else str(v)


def current_vital_value(op_type: str, current_vitals: Mapping[str, Any] | None) -> str | None:
    """患者**当前状态**里该指标的读数（``runtime_state.scene.vitals``）。

    只认能当读数用的数值：未测量（键不存在 / ``None``）、脏值（非数值串）、
    半条血压（只有收缩压或只有舒张压）一律返回 ``None`` —— 交由病例配置回落，
    而不是把不完整的事实硬凑成一个读数。
    """
    if not isinstance(current_vitals, Mapping):
        return None
    keys = VITAL_KEYS_BY_OP.get(op_type)
    if not keys:
        return None
    if op_type == "bp":
        sys_v = _parse_num(current_vitals.get("bp_sys"))
        dia_v = _parse_num(current_vitals.get("bp_dia"))
        if sys_v is None or dia_v is None:
            return None
        return f"{_format_num(sys_v)}/{_format_num(dia_v)}"
    v = _parse_num(current_vitals.get(keys[0]))
    return None if v is None else _format_num(v)


def _resolve_physiology(case_data: dict, current_vitals: Mapping[str, Any] | None = None) -> dict[str, str]:
    """解析全部体征：当前状态 > 病例声明值 > 年龄默认值（未配置项叠加代偿偏移）。

    优先级就是"一个事实一个 owner"的时序版本：``current_vitals``
    （``runtime_state.scene.vitals``）是患者**当前**状态的 owner，病例
    ``activities.physical_exam.config`` 只是**初始值**。床旁读到的必须与屏幕上的一致，
    所以场景里已经写过的指标以场景为准；没写过的才回落到病例配置。

    回落集合同时是代偿偏移的输入——偏移依据的是**当前**体征，而不是被病程推进
    取代过的初始值（否则"患者已经低氧了，派生呼吸频率却按初始值算"）。
    """
    anchors = _activity_anchors(case_data)
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

    # 场景里写过的（当前状态）覆盖病例声明（初始值）
    for op_type in _VITAL_ORDER:
        current = current_vital_value(op_type, current_vitals)
        if current is not None:
            configured[op_type] = current

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


def handle_operation(
    op_type: str,
    case_data: dict,
    *,
    current_vitals: Mapping[str, Any] | None = None,
) -> dict:
    """执行一项查体/测量操作。

    所有标准操作始终可用：体征优先读患者**当前状态**（``current_vitals`` —— 即
    ``runtime_state.scene.vitals``，读写两侧与前端下发认的都是这一份），病例声明的
    ``activities.physical_exam.config`` 退居**初始值**，两者都没有时按患者年龄返回临床合理默认值。
    不传 ``current_vitals`` 时与只读病例配置的老行为一致。

    解读（``interpretation``）拿的就是上面算出的同一个 ``value``，不存在"显示一个值、
    按另一个值判定"的第二条路径。
    """
    anchors = _activity_anchors(case_data)
    op_defs = _collect_op_defs(anchors)
    op_def = op_defs.get(op_type)
    if not op_def:
        # 客户端错误（400）：旧实现返回 {"type": "error", ...}，被 PhysicalExamHandler
        # 当作正常结果写进 exam_results / 审计 / 评分时间线（一条伪查体记录）。
        raise ValidationError(detail=f"不支持的操作: {op_type}")

    if op_type in _VITAL_OPS or op_type == "pain":
        value = _resolve_physiology(case_data, current_vitals).get(op_type, "—")
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
    """Try to resolve from the declared physical_exam config. Returns None if not configured."""
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
            # 与其它体征同样走 range 归一化：病例里 pain_score 常写成 "4-6"，
            # 直接返回原串会让下游 float() 抛错（场景体征写入与情绪桥接双双静默失败）。
            return _resolve_range(str(nrs))
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
