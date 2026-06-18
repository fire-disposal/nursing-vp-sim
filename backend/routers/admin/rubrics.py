"""Rubric CRUD"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import require_permission
from models import Rubric, User
from schemas import DeleteResponse, OkResponse, RubricCreateRequest, RubricResponse

router = APIRouter(prefix="/api")


@router.get("/rubrics", response_model=list[RubricResponse])
def list_rubrics(
    current_user: Annotated[User, Depends(require_permission("api_manage"))], db: Annotated[Session, Depends(get_db)]
):
    return db.query(Rubric).order_by(Rubric.created_at.desc()).all()


@router.get("/rubrics/active", response_model=RubricResponse)
def get_active_rubric(current_user: Annotated[User, Depends(require_permission("api_manage"))]):
    from repositories.rubric import load_active_rubric

    active = load_active_rubric()
    if not active:
        raise HTTPException(status_code=404, detail="没有激活的评分标准")
    return active


@router.post("/rubrics", status_code=201, response_model=RubricResponse)
def create_rubric(
    data: RubricCreateRequest,
    current_user: Annotated[User, Depends(require_permission("api_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    from repositories.rubric import validate_dimensions

    errors = validate_dimensions(data.dimensions)
    if errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))
    rubric = Rubric(
        name=data.name,
        version=data.version,
        description=data.description,
        total_max=data.total_max,
        raw_max=data.raw_max,
        raw_scale=data.raw_scale,
        dimensions=data.dimensions,
    )
    db.add(rubric)
    db.commit()
    db.refresh(rubric)
    return rubric


@router.put("/rubrics/{rubric_id}", response_model=RubricResponse)
def update_rubric(
    rubric_id: int,
    data: RubricCreateRequest,
    current_user: Annotated[User, Depends(require_permission("api_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    from repositories.rubric import validate_dimensions

    rubric = db.query(Rubric).filter(Rubric.id == rubric_id).first()
    if not rubric:
        raise HTTPException(status_code=404, detail="评分标准不存在")
    errors = validate_dimensions(data.dimensions)
    if errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))
    rubric.dimensions = data.dimensions
    rubric.name = data.name
    rubric.version = data.version
    rubric.description = data.description
    rubric.total_max = data.total_max
    rubric.raw_max = data.raw_max
    rubric.raw_scale = data.raw_scale
    db.commit()
    return rubric


@router.delete("/rubrics/{rubric_id}", response_model=DeleteResponse)
def delete_rubric(
    rubric_id: int,
    current_user: Annotated[User, Depends(require_permission("api_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    rubric = db.query(Rubric).filter(Rubric.id == rubric_id).first()
    if not rubric:
        raise HTTPException(status_code=404, detail="评分标准不存在")
    if rubric.is_active:
        raise HTTPException(status_code=400, detail="不能删除当前激活的评分标准")
    db.delete(rubric)
    db.commit()
    return {"ok": True}


@router.post("/rubrics/{rubric_id}/activate", response_model=OkResponse)
def activate_rubric(
    rubric_id: int,
    current_user: Annotated[User, Depends(require_permission("api_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    rubric = db.query(Rubric).filter(Rubric.id == rubric_id).first()
    if not rubric:
        raise HTTPException(status_code=404, detail="评分标准不存在")
    db.query(Rubric).update({"is_active": False})
    rubric.is_active = True
    db.commit()
    return {"ok": True}
