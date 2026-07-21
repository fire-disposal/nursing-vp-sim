from typing import Annotated

from fastapi import APIRouter, Depends

from core.deps import DbSession
from core.security import require_permission
from models import User
from schemas import DeleteResponse, GradeCreate, GradeResponse, GradeUpdate
from services.grade import GradeService

router = APIRouter(prefix="/grades", tags=["年级管理"])

_Manager = Annotated[User, Depends(require_permission("grade_class_manage"))]


def _resp(view) -> GradeResponse:
    return GradeResponse(
        id=view.id,
        name=view.name,
        class_count=view.class_count,
        student_count=view.student_count,
        created_at=view.created_at,
    )


@router.get("", response_model=list[GradeResponse])
def list_grades(current_user: _Manager, db: DbSession):
    return [_resp(v) for v in GradeService(db).list_all()]


@router.post("", response_model=GradeResponse)
def create_grade(body: GradeCreate, current_user: _Manager, db: DbSession):
    return _resp(GradeService(db).create(body.name))


@router.put("/{grade_id}", response_model=GradeResponse)
def update_grade(grade_id: int, body: GradeUpdate, current_user: _Manager, db: DbSession):
    return _resp(GradeService(db).update(grade_id, body.name))


@router.delete("/{grade_id}", response_model=DeleteResponse)
def delete_grade(grade_id: int, current_user: _Manager, db: DbSession):
    class_count = GradeService(db).delete(grade_id)
    return {"message": f"已删除年级及其下 {class_count} 个班级"}
