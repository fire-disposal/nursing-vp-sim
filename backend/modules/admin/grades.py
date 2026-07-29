from dataclasses import dataclass
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from core.deps import DbSession
from core.exceptions import ValidationError
from core.security import require_permission
from core.unit_of_work import unit_of_work
from models import Grade, User
from repositories.grade import GradeRepository
from repositories.shared import nullify_user_class_associations
from schemas import DeleteResponse, GradeCreate, GradeResponse, GradeUpdate


@dataclass
class GradeView:
    id: int
    name: str
    class_count: int
    student_count: int
    created_at: datetime


class GradeService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = GradeRepository(db)

    def _view(self, grade: Grade, class_count: int = 0, student_count: int = 0) -> GradeView:
        return GradeView(grade.id, grade.name, class_count, student_count, grade.created_at)

    def list_all(self) -> list[GradeView]:
        grades = self.repo.list_ordered()
        ids = [g.id for g in grades]
        cc = self.repo.class_counts(ids)
        sc = self.repo.student_counts(ids)
        return [self._view(g, cc.get(g.id, 0), sc.get(g.id, 0)) for g in grades]

    def create(self, name: str) -> GradeView:
        if self.repo.name_exists(name):
            raise ValidationError("年级已存在")
        with unit_of_work(self.db, conflict_detail="年级已存在"):
            grade = self.repo.add(Grade(name=name))
        return self._view(grade)

    def update(self, grade_id: int, name: str) -> GradeView:
        grade = self.repo.get_or_404(grade_id, "年级不存在")
        if name != grade.name and self.repo.name_exists(name, exclude_id=grade_id):
            raise ValidationError("年级名称重复")
        with unit_of_work(self.db, conflict_detail="年级名称重复"):
            grade.name = name
            self.db.flush()
        cc = self.repo.class_counts([grade.id])
        sc = self.repo.student_counts([grade.id])
        return self._view(grade, cc.get(grade.id, 0), sc.get(grade.id, 0))

    def delete(self, grade_id: int) -> int:
        grade = self.repo.get_or_404(grade_id, "年级不存在")
        class_ids = self.repo.class_ids_for(grade_id)
        assignment_count = self.repo.assignment_count_for_classes(class_ids)
        if assignment_count > 0:
            raise ValidationError(f"该年级下有 {assignment_count} 个作业引用，无法删除。请先删除相关作业。")
        class_count = len(class_ids)
        with unit_of_work(self.db, conflict_detail="操作冲突：该年级下在删除过程中新增了关联资源，请刷新后重试。"):
            nullify_user_class_associations(self.db, class_ids)
            self.repo.delete(grade)
        return class_count

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
