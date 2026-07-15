from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import update as sa_update

from core.exceptions import ValidationError
from core.unit_of_work import unit_of_work
from models import Grade, UserClass
from repositories.grade import GradeRepository

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


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

    def list(self) -> list[GradeView]:
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
            if class_ids:
                self.db.execute(sa_update(UserClass).where(UserClass.class_id.in_(class_ids)).values(class_id=None))
            self.repo.delete(grade)
        return class_count
