"""Triage router — submit triage result and trigger scoring."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

from core.database import get_db
from core.security import get_current_user
from models import TrainingRecord, User

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/triage", tags=["分诊"])


class TriageSubmitRequest(BaseModel):
    mews_score: int = Field(ge=0, le=14)
    category: str = Field(min_length=1)
    department: str = Field(min_length=1)
    notes: str = ""


class TriageSubmitResponse(BaseModel):
    message: str
    record_id: int


_TRIAGE_CATEGORIES = ["red", "orange", "yellow", "green", "blue"]
_TRIAGE_DEPARTMENTS = ["内科", "外科", "妇产科", "儿科", "急诊科", "ICU", "骨科", "神经科"]


@router.post("/{record_id}/submit", response_model=TriageSubmitResponse)
def submit_triage(
    record_id: int,
    req: TriageSubmitRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能操作自己的训练")
    if record.status != "in_progress":
        raise HTTPException(status_code=400, detail="训练已结束")

    if req.category not in _TRIAGE_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"无效的分诊级别: {req.category}")
    if req.department not in _TRIAGE_DEPARTMENTS:
        raise HTTPException(status_code=400, detail=f"无效的目标科室: {req.department}")

    rs = dict(record.runtime_state or {})
    rs["triage_result"] = {
        "mews_score": req.mews_score,
        "category": req.category,
        "department": req.department,
        "notes": req.notes,
    }
    rs["phase_op_count"] = rs.get("phase_op_count", 0) + 1
    record.runtime_state = rs
    db.commit()

    log.info("Triage submitted: record_id=%d category=%s department=%s mews=%d",
             record_id, req.category, req.department, req.mews_score)

    return TriageSubmitResponse(message="分诊完成", record_id=record_id)
