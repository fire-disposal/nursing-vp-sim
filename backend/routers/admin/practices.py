"""Practice CRUD — admin management of training practice templates."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from core.deps import DbSession
from core.security import require_permission
from infrastructure.exporter import ColumnDef, export_response
from models import User
from schemas import (
    DeleteResponse,
    PaginatedResponse,
    PracticeCreate,
    PracticeItem,
    PracticeResponse,
    PracticeUpdate,
)
from services.practice import PracticeService

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/practices", tags=["练习管理"])

_Manager = Annotated[User, Depends(require_permission("case_manage"))]


def _resp(view) -> PracticeResponse:
    return PracticeResponse(
        id=view.id,
        name=view.name,
        description=view.description,
        case_id=view.case_id,
        case_name=view.case_name,
        features=view.features,
        behavior=view.behavior,
        is_active=view.is_active,
        training_count=view.training_count,
        created_at=view.created_at,
        updated_at=view.updated_at,
    )


@router.get("", response_model=PaginatedResponse[PracticeItem])
def list_practices(
    current_user: _Manager,
    db: DbSession,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
):
    views, total = PracticeService(db).list(offset, limit)
    return PaginatedResponse(
        items=[_resp(v) for v in views],
        total=total,
        offset=offset,
        limit=limit,
    )


@router.get("/{practice_id}", response_model=PracticeResponse)
def get_practice(
    practice_id: int,
    current_user: _Manager,
    db: DbSession,
):
    return _resp(PracticeService(db).get(practice_id))


@router.post("", status_code=201, response_model=PracticeResponse)
def create_practice(
    body: PracticeCreate,
    current_user: _Manager,
    db: DbSession,
):
    view = PracticeService(db).create(body)
    log.info(
        "Practice created: id=%d name=%s",
        view.id,
        view.name,
        extra={"user_id": current_user.id},
    )
    return _resp(view)


@router.put("/{practice_id}", response_model=PracticeResponse)
def update_practice(
    practice_id: int,
    body: PracticeUpdate,
    current_user: _Manager,
    db: DbSession,
):
    view = PracticeService(db).update(practice_id, body)
    log.info(
        "Practice updated: id=%d name=%s",
        view.id,
        view.name,
        extra={"user_id": current_user.id},
    )
    return _resp(view)


@router.get("/export")
def export_practices(
    current_user: _Manager,
    db: DbSession,
    format: str = Query("csv", pattern="^(csv|xlsx)$"),
):
    from sqlalchemy import func

    from models import Practice, TrainingRecord

    practices = (
        db.query(Practice, func.count(Practice.id).label("training_count"))
        .outerjoin(TrainingRecord, TrainingRecord.practice_id == Practice.id)
        .group_by(Practice.id)
        .order_by(Practice.name)
        .all()
    )
    columns = [
        ColumnDef("名称", key="name"),
        ColumnDef("说明", key="description"),
        ColumnDef("功能", value=lambda r: "、".join(k for k, v in (r.features or {}).items() if v) or "—"),
        ColumnDef("训练次数", key="training_count"),
    ]
    return export_response(practices, columns, "练习模板列表", "练习模板列表", format)


@router.delete("/{practice_id}", response_model=DeleteResponse)
def delete_practice(
    practice_id: int,
    current_user: _Manager,
    db: DbSession,
):
    PracticeService(db).delete(practice_id)
    log.info(
        "Practice deleted: id=%d",
        practice_id,
        extra={"user_id": current_user.id},
    )
    return DeleteResponse(ok=True)
