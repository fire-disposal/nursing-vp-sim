"""Practice CRUD — admin management of training practice templates."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from core.database import get_db
from core.pagination import paginate
from core.security import require_permission
from models import Assignment, Case, Practice, TrainingRecord, User
from schemas import (
    DeleteResponse,
    PaginatedResponse,
    PracticeCreate,
    PracticeItem,
    PracticeResponse,
    PracticeUpdate,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/practices", tags=["练习管理"])


def _to_item(p: Practice, training_count: int = 0) -> PracticeItem:
    return PracticeItem(
        id=p.id,
        name=p.name,
        description=p.description,
        case_id=p.case_id,
        case_name=p.case.name if p.case else "",
        mode=p.mode,
        features=p.features or {},
        behavior=p.behavior or {},
        assessment=p.assessment,
        is_active=p.is_active,
        training_count=training_count,
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


@router.get("", response_model=PaginatedResponse[PracticeItem])
def list_practices(
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    current_user: User = Depends(require_permission("case_manage")),
    db: Session = Depends(get_db),
):
    query = (
        db.query(Practice)
        .options(joinedload(Practice.case))
        .filter(Practice.school_id == current_user.school_id)
        .order_by(Practice.created_at.desc())
    )
    practices, total = paginate(query, offset, limit)

    practice_ids = [p.id for p in practices]
    training_counts: dict[int, int] = {}
    if practice_ids:
        rows = (
            db.query(TrainingRecord.practice_id, func.count(TrainingRecord.id))
            .filter(TrainingRecord.practice_id.in_(practice_ids))
            .group_by(TrainingRecord.practice_id)
            .all()
        )
        training_counts = {pid: cnt for pid, cnt in rows}

    return PaginatedResponse(
        items=[_to_item(p, training_counts.get(p.id, 0)) for p in practices],
        total=total,
        offset=offset,
        limit=limit,
    )


@router.get("/{practice_id}", response_model=PracticeResponse)
def get_practice(
    practice_id: int,
    current_user: User = Depends(require_permission("case_manage")),
    db: Session = Depends(get_db),
):
    p = db.query(Practice).options(joinedload(Practice.case)).filter(Practice.id == practice_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="练习模板不存在")
    return _to_item(p)


@router.post("", status_code=201, response_model=PracticeResponse)
def create_practice(
    data: PracticeCreate,
    current_user: User = Depends(require_permission("case_manage")),
    db: Session = Depends(get_db),
):
    case = db.query(Case).filter(Case.id == data.case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")
    if case.school_id is not None and case.school_id != current_user.school_id:
        raise HTTPException(status_code=403, detail="无权使用该校病例")

    p = Practice(
        name=data.name,
        description=data.description,
        case_id=data.case_id,
        school_id=current_user.school_id,
        mode=data.mode,
        features=data.features or {},
        behavior=data.behavior or {},
        assessment=data.assessment,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    log.info("Practice created: id=%d name=%s", p.id, p.name, extra={"user_id": current_user.id})
    return _to_item(p)


@router.put("/{practice_id}", response_model=PracticeResponse)
def update_practice(
    practice_id: int,
    data: PracticeUpdate,
    current_user: User = Depends(require_permission("case_manage")),
    db: Session = Depends(get_db),
):
    p = db.query(Practice).filter(Practice.id == practice_id, Practice.school_id == current_user.school_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="练习模板不存在")

    for field in ("name", "description", "case_id", "mode", "is_active"):
        val = getattr(data, field, None)
        if val is not None:
            setattr(p, field, val)
    if data.features is not None:
        p.features = data.features
    if data.behavior is not None:
        p.behavior = data.behavior
    if data.assessment is not None:
        p.assessment = data.assessment

    db.commit()
    db.refresh(p)
    log.info("Practice updated: id=%d name=%s", p.id, p.name, extra={"user_id": current_user.id})
    return _to_item(p)


@router.delete("/{practice_id}", response_model=DeleteResponse)
def delete_practice(
    practice_id: int,
    current_user: User = Depends(require_permission("case_manage")),
    db: Session = Depends(get_db),
):
    p = db.query(Practice).filter(Practice.id == practice_id, Practice.school_id == current_user.school_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="练习模板不存在")

    existing_assignment = db.query(Assignment).filter(Assignment.practice_id == practice_id).first()
    if existing_assignment:
        raise HTTPException(status_code=400, detail="该练习存在关联的作业，无法删除")

    count = db.query(func.count(TrainingRecord.id)).filter(TrainingRecord.practice_id == practice_id).scalar() or 0
    if count > 0:
        raise HTTPException(status_code=400, detail=f"该练习已有 {count} 条训练记录，无法删除")

    db.delete(p)
    db.commit()
    log.info("Practice deleted: id=%d name=%s", practice_id, p.name, extra={"user_id": current_user.id})
    return {"ok": True}
