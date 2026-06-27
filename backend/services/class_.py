from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import update as sa_update
from sqlalchemy.orm import Session

from core.exceptions import NotFoundError, ValidationError
from core.unit_of_work import unit_of_work
from models import Class, UserClass
from repositories.class_ import ClassRepository


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

    def list(self, grade_id: int | None = None) -> list[ClassView]:
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

        effective_grade_id = grade_id if grade_id is not None else cls.grade_id

        if grade_id is not None:
            if not self.repo.get_grade(grade_id):
                raise NotFoundError("年级不存在")

        if name is not None:
            if self.repo.name_exists_in_grade(effective_grade_id, name, exclude_id=class_id):
                raise ValidationError("该年级下班级名称重复")

        with unit_of_work(self.db, conflict_detail="该年级下班级名称重复"):
            if grade_id is not None:
                cls.grade_id = grade_id
            if name is not None:
                cls.name = name
            self.db.flush()

        grade = self.repo.get_grade(cls.grade_id)
        student_count = self.repo.student_counts([cls.id]).get(cls.id, 0)
        return ClassView(
            id=cls.id,
            grade_id=cls.grade_id,
            grade_name=grade.name if grade else "",
            name=cls.name,
            student_count=student_count,
            created_at=cls.created_at,
        )

    def delete(self, class_id: int) -> str:
        cls = self.repo.get_or_404(class_id, "班级不存在")
        ac = self.repo.assignment_count(class_id)
        if ac > 0:
            raise ValidationError(f"该班级下有 {ac} 个作业引用，无法删除")
        with unit_of_work(self.db, conflict_detail="操作冲突：该班级下存在关联资源，请刷新后重试。"):
            self.db.execute(sa_update(UserClass).where(UserClass.class_id == class_id).values(class_id=None))
            self.repo.delete(cls)
        return cls.name
