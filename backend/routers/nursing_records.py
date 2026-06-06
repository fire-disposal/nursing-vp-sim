"""护理记录 API — SOAP 格式模板"""

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import get_current_user
from models import NursingRecord, TrainingRecord, User

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["护理记录"])

_REQ_CFG = ConfigDict(extra="forbid", str_strip_whitespace=True)
_RESP_CFG = ConfigDict(from_attributes=True)


class NursingRecordSave(BaseModel):
    model_config = _REQ_CFG
    subjective: str | None = Field(default=None, max_length=4096)
    objective: str | None = Field(default=None, max_length=4096)
    assessment: str | None = Field(default=None, max_length=4096)
    plan: str | None = Field(default=None, max_length=4096)
    status: str = "draft"


class NursingRecordResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    record_id: int
    subjective: str | None = None
    objective: str | None = None
    assessment: str | None = None
    plan: str | None = None
    status: str
    updated_at: datetime


@router.get("/nursing-records/{record_id}", response_model=NursingRecordResponse)
def get_nursing_record(
    record_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """获取某次训练的护理记录"""
    nr = db.query(NursingRecord).filter(NursingRecord.record_id == record_id).first()
    if not nr:
        raise HTTPException(status_code=404, detail="未找到护理记录")
    if nr.user_id != current_user.id and not current_user.has_permission("score_review"):
        raise HTTPException(status_code=403, detail="无权限")
    return nr


@router.post("/nursing-records/{record_id}", response_model=NursingRecordResponse)
def save_nursing_record(
    record_id: int,
    req: NursingRecordSave,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """创建或更新某次训练的护理记录"""
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")

    nr = db.query(NursingRecord).filter(NursingRecord.record_id == record_id).first()
    if nr:
        if req.subjective is not None:
            nr.subjective = req.subjective
        if req.objective is not None:
            nr.objective = req.objective
        if req.assessment is not None:
            nr.assessment = req.assessment
        if req.plan is not None:
            nr.plan = req.plan
        if req.status:
            nr.status = req.status
        nr.updated_at = datetime.now(UTC)
    else:
        nr = NursingRecord(
            record_id=record_id,
            user_id=current_user.id,
            subjective=req.subjective,
            objective=req.objective,
            assessment=req.assessment,
            plan=req.plan,
            status=req.status or "draft",
        )
        db.add(nr)

    db.commit()
    db.refresh(nr)
    return nr
