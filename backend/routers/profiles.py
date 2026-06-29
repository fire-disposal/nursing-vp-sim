"""Profiles API — expose available training types to frontend."""

import logging

from fastapi import APIRouter

from profiles.registry import get_known_types, get_profile

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/profiles", tags=["训练类型"])


@router.get("")
def list_profiles():
    """Return all registered training types with metadata."""
    types = get_known_types()
    result = []
    for t in types:
        p = get_profile(t)
        result.append({
            "type": p.name,
            "label": _TYPE_LABELS.get(p.name, p.name),
            "description": _TYPE_DESCRIPTIONS.get(p.name, ""),
            "icon": _TYPE_ICONS.get(p.name, "ClipboardList"),
            "color": _TYPE_COLORS.get(p.name, "blue"),
            "case_count_hint": _TYPE_HINTS.get(p.name, ""),
        })
    return {"items": result}


_TYPE_LABELS = {
    "history_taking": "病史采集",
    "triage": "预检分诊",
}

_TYPE_DESCRIPTIONS = {
    "history_taking": "与虚拟患者对话，采集完整病史信息。练习问诊技巧、沟通能力和临床思维。",
    "triage": "根据患者生命体征和临床表现，快速完成分诊评估。练习MEWS评分、分诊级别判定。",
}

_TYPE_ICONS = {
    "history_taking": "Stethoscope",
    "triage": "Ambulance",
}

_TYPE_COLORS = {
    "history_taking": "blue",
    "triage": "red",
}

_TYPE_HINTS = {
    "history_taking": "",
    "triage": "",
}
