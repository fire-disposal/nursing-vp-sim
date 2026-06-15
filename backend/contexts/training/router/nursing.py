"""护理记录 API — 结构化 sheet_data JSONB 存储"""

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import get_current_user
from models import NursingRecord, TrainingRecord, User
from schemas import NursingRecordResponse, NursingRecordSave

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["护理记录"])


@router.get("/nursing-records/{record_id}", response_model=NursingRecordResponse)
def get_nursing_record(
    record_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    nr = db.query(NursingRecord).filter(NursingRecord.record_id == record_id).first()
    if not nr:
        return NursingRecordResponse(
            id=0,
            record_id=record_id,
            sheet_data={},
            status="not_found",
            updated_at=datetime.now(UTC),
        )
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
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权操作此训练记录")

    nr = db.query(NursingRecord).filter(NursingRecord.record_id == record_id).first()
    if nr:
        nr.sheet_data = req.sheet_data
        nr.status = req.status
        nr.updated_at = datetime.now(UTC)
    else:
        nr = NursingRecord(
            record_id=record_id,
            user_id=current_user.id,
            sheet_data=req.sheet_data,
            status=req.status or "draft",
        )
        db.add(nr)

    db.commit()
    db.refresh(nr)
    return nr
