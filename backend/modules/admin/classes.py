from dataclasses import dataclass
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from core.deps import DbSession
from core.exceptions import NotFoundError, ValidationError
from core.security import require_permission
from core.unit_of_work import unit_of_work
from models import Class, User
from repositories.class_ import ClassRepository
from repositories.shared import nullify_user_class_associations
from schemas import ClassCreate, ClassResponse, ClassUpdate, DeleteResponse


@dataclass
class ClassView:
    id: int
    grade_id: int
    grade_name: str
    name: str
    student_count: int
    created_at: datetime


class ClassService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = ClassRepository(db)

    def list_all(self, grade_id: int | None = None) -> list[ClassView]:
        rows = self.repo.list_with_grade(grade_id)
        class_ids = [cls.id for cls, _ in rows]
        counts = self.repo.student_counts(class_ids)
        return [
            ClassView(
                id=cls.id,
                grade_id=cls.grade_id,
                grade_name=grade_name,
                name=cls.name,
                student_count=counts.get(cls.id, 0),
                created_at=cls.created_at,
            )
            for cls, grade_name in rows
        ]

    def create(self, grade_id: int, name: str) -> ClassView:
        grade = self.repo.get_grade(grade_id)
        if not grade:
            raise NotFoundError("年级不存在")
        if self.repo.name_exists_in_grade(grade_id, name):
            raise ValidationError("该年级下班级名称重复")
        with unit_of_work(self.db, conflict_detail="该年级下班级名称重复"):
            cls = self.repo.add(Class(grade_id=grade_id, name=name))
        return ClassView(
            id=cls.id,
            grade_id=cls.grade_id,
            grade_name=grade.name,
            name=cls.name,
            student_count=0,
            created_at=cls.created_at,
        )

    def update(self, class_id: int, *, name: str | None = None, grade_id: int | None = None) -> ClassView:
        cls = self.repo.get_or_404(class_id, "班级不存在")
        if grade_id is not None:
            grade = self.repo.get_grade(grade_id)
            if not grade:
                raise NotFoundError("年级不存在")
            if self.repo.name_exists_in_grade(grade_id, name or cls.name):
                raise ValidationError("该年级下班级名称重复")
            cls.grade_id = grade_id
        if name is not None:
            if self.repo.name_exists_in_grade(cls.grade_id, name, exclude_id=cls.id):
                raise ValidationError("该年级下班级名称重复")
            cls.name = name
        self.repo.flush()
        return ClassView(
            id=cls.id,
            grade_id=cls.grade_id,
            grade_name=grade.name if grade else cls.grade.name,
            name=cls.name,
            student_count=0,
            created_at=cls.created_at,
        )

    def delete(self, class_id: int) -> str:
        cls = self.repo.get_or_404(class_id, "班级不存在")
        name = cls.name
        with unit_of_work(self.db, conflict_detail="无法删除"):
            self.repo.delete(cls)
            nullify_user_class_associations(self.db, class_id=class_id)
        return name

router = APIRouter(prefix="/classes", tags=["班级管理"])

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
    return [_resp(v) for v in ClassService(db).list_all(grade_id=grade_id)]


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
