"""Rubric CRUD — thin router."""

from typing import Annotated

from fastapi import APIRouter, Depends

from core.deps import DbSession
from core.exceptions import NotFoundError
from core.security import require_permission
from models import User
from repositories.rubric import load_active_rubric
from schemas import DeleteResponse, OkResponse, RubricCreateRequest, RubricResponse
from services.rubric import RubricService

router = APIRouter()

_Manager = Annotated[User, Depends(require_permission("api_manage"))]


@router.get("/rubrics", response_model=list[RubricResponse])
def list_rubrics(current_user: _Manager, db: DbSession):
    return RubricService(db).list()


@router.get("/rubrics/active", response_model=RubricResponse)
def get_active_rubric(current_user: _Manager):
    active = load_active_rubric()
    if not active:
        raise NotFoundError("没有激活的评分标准")
    return active


@router.post("/rubrics", status_code=201, response_model=RubricResponse)
def create_rubric(data: RubricCreateRequest, current_user: _Manager, db: DbSession):
    return RubricService(db).create(data.model_dump())


@router.put("/rubrics/{rubric_id}", response_model=RubricResponse)
def update_rubric(rubric_id: int, data: RubricCreateRequest, current_user: _Manager, db: DbSession):
    return RubricService(db).update(rubric_id, data.model_dump())


@router.delete("/rubrics/{rubric_id}", response_model=DeleteResponse)
def delete_rubric(rubric_id: int, current_user: _Manager, db: DbSession):
    RubricService(db).delete(rubric_id)
    return {"ok": True}


@router.post("/rubrics/{rubric_id}/activate", response_model=OkResponse)
def activate_rubric(rubric_id: int, current_user: _Manager, db: DbSession):
    RubricService(db).activate(rubric_id)
    return {"ok": True}
