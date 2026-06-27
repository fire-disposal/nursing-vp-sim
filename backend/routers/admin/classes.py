from typing import Annotated

from fastapi import APIRouter, Depends, Query

from core.deps import DbSession
from core.security import require_permission
from models import User
from schemas import ClassCreate, ClassResponse, ClassUpdate, DeleteResponse
from services.class_ import ClassService

router = APIRouter(prefix="/api/admin/classes", tags=["班级管理"])

_Manager = Annotated[User, Depends(require_permission("grade_class_manage"))]


def _resp(view) -> ClassResponse:
    return ClassResponse(
        id=view.id,
        grade_id=view.grade_id,
        grade_name=view.grade_name,
        name=view.name,
        student_count=view.student_count,
        created_at=view.created_at,
    )


@router.get("", response_model=list[ClassResponse])
def list_classes(
    current_user: _Manager,
    db: DbSession,
    grade_id: Annotated[int | None, Query()] = None,
):
    return [_resp(v) for v in ClassService(db).list(grade_id=grade_id)]


@router.post("", response_model=ClassResponse)
def create_class(body: ClassCreate, current_user: _Manager, db: DbSession):
    return _resp(ClassService(db).create(body.grade_id, body.name))


@router.put("/{class_id}", response_model=ClassResponse)
def update_class(class_id: int, body: ClassUpdate, current_user: _Manager, db: DbSession):
    return _resp(ClassService(db).update(class_id, name=body.name, grade_id=body.grade_id))


@router.delete("/{class_id}", response_model=DeleteResponse)
def delete_class(class_id: int, current_user: _Manager, db: DbSession):
    name = ClassService(db).delete(class_id)
    return {"message": f"已删除班级 {name}"}
