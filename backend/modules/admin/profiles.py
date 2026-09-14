"""Profiles API — expose available training types to frontend."""

import logging

from fastapi import APIRouter
from sqlalchemy import func

from core.deps import CurrentUser, DbSession
from models import Case
from modules.training.profile import PROFILE

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/profiles", tags=["训练类型"])

# 单一训练类型的展示元数据。此前按 type 分了 4 个 _TYPE_* 字典（外加一个没有任何
# 读取方的 _TYPE_HINTS），让人误以为存在多类型分派；实际只有 modules/training/profile.PROFILE
# 一个档案，直接写字面量即可（新增类型时在这里加分支，而不是留下空壳字典）。
_PROFILE_META = {
    "label": "病史采集",
    "description": "与虚拟患者对话，采集完整病史信息。练习问诊技巧、沟通能力和临床思维。",
    "icon": "Stethoscope",
    "color": "blue",
}


@router.get("")
def list_profiles(db: DbSession, current_user: CurrentUser):
    """Return the registered training type with metadata."""
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
            "label": _PROFILE_META["label"],
            "description": _PROFILE_META["description"],
            "icon": _PROFILE_META["icon"],
            "color": _PROFILE_META["color"],
            "case_count": type_counts.get(p.name, 0),
        }
    ]
    return {"items": result}
