"""Profiles API — expose available training types to frontend."""

import logging

from fastapi import APIRouter
from sqlalchemy import func

from core.deps import CurrentUser, DbSession
from models import Case
from profiles.history_taking import PROFILE

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/profiles", tags=["训练类型"])


@router.get("")
def list_profiles(db: DbSession, current_user: CurrentUser):
    """Return all registered training types with metadata."""
    type_counts: dict[str, int] = {
        training_type: count
        for training_type, count in db.query(Case.training_type, func.count(Case.id))
        .filter(Case.is_open == True)
        .group_by(Case.training_type)
        .all()
    }
    p = PROFILE
    result = [
        {
            "type": p.name,
            "label": _TYPE_LABELS.get(p.name, p.name),
            "description": _TYPE_DESCRIPTIONS.get(p.name, ""),
            "icon": _TYPE_ICONS.get(p.name, "ClipboardList"),
            "color": _TYPE_COLORS.get(p.name, "blue"),
            "case_count": type_counts.get(p.name, 0),
        }
    ]
    return {"items": result}


_TYPE_LABELS = {
    "history_taking": "病史采集",
}

_TYPE_DESCRIPTIONS = {
    "history_taking": "与虚拟患者对话，采集完整病史信息。练习问诊技巧、沟通能力和临床思维。",
}

_TYPE_ICONS = {
    "history_taking": "Stethoscope",
}

_TYPE_COLORS = {
    "history_taking": "blue",
}

_TYPE_HINTS = {
    "history_taking": "",
}
