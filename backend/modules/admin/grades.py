from dataclasses import dataclass
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy import update as sa_update
from sqlalchemy.orm import Session

from core.deps import DbSession
from core.exceptions import NotFoundError, ValidationError
from core.security import require_permission
from core.unit_of_work import unit_of_work
from models import Assignment, Class, Grade, User, UserClass
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

    def _view(self, grade: Grade, class_count: int = 0, student_count: int = 0) -> GradeView:
        return GradeView(grade.id, grade.name, class_count, student_count, grade.created_at)

    def list_all(self) -> list[GradeView]:
        grades = self._list_ordered()
        ids = [g.id for g in grades]
        cc = self._class_counts(ids)
        sc = self._student_counts(ids)
        return [self._view(g, cc.get(g.id, 0), sc.get(g.id, 0)) for g in grades]

    def create(self, name: str) -> GradeView:
        if self._name_exists(name):
            raise ValidationError("年级已存在")
        with unit_of_work(self.db, conflict_detail="年级已存在"):
            grade = Grade(name=name)
            self.db.add(grade)
            self.db.flush()
        return self._view(grade)

    def update(self, grade_id: int, name: str) -> GradeView:
        grade = self.db.get(Grade, grade_id)
        if grade is None:
            raise NotFoundError("年级不存在")
        if name != grade.name and self._name_exists(name, exclude_id=grade_id):
            raise ValidationError("年级名称重复")
        with unit_of_work(self.db, conflict_detail="年级名称重复"):
            grade.name = name
            self.db.flush()
        cc = self._class_counts([grade.id])
        sc = self._student_counts([grade.id])
        return self._view(grade, cc.get(grade.id, 0), sc.get(grade.id, 0))

    def delete(self, grade_id: int) -> int:
        grade = self.db.get(Grade, grade_id)
        if grade is None:
            raise NotFoundError("年级不存在")
        class_ids = self._class_ids_for(grade_id)
        assignment_count = self._assignment_count_for_classes(class_ids)
        if assignment_count > 0:
            raise ValidationError(f"该年级下有 {assignment_count} 个作业引用，无法删除。请先删除相关作业。")
        class_count = len(class_ids)
        with unit_of_work(self.db, conflict_detail="操作冲突：该年级下在删除过程中新增了关联资源，请刷新后重试。"):
            self.db.execute(
                sa_update(UserClass)
                .where(UserClass.class_id.in_(class_ids))
                .values(class_id=None)
            )
            self.db.delete(grade)
            self.db.flush()
        return class_count

    def _list_ordered(self) -> list[Grade]:
        return self.db.query(Grade).order_by(Grade.name).all()

    def _name_exists(self, name: str, exclude_id: int | None = None) -> bool:
        q = self.db.query(Grade).filter(Grade.name == name)
        if exclude_id is not None:
            q = q.filter(Grade.id != exclude_id)
        return bool(self.db.query(q.exists()).scalar())

    def _class_counts(self, grade_ids: list[int]) -> dict[int, int]:
        if not grade_ids:
            return {}
        rows = (
            self.db.query(Class.grade_id, func.count(Class.id))
            .filter(Class.grade_id.in_(grade_ids))
            .group_by(Class.grade_id)
            .all()
        )
        return {gid: c for gid, c in rows}

    def _student_counts(self, grade_ids: list[int]) -> dict[int, int]:
        if not grade_ids:
            return {}
        rows = (
            self.db.query(Class.grade_id, func.count(UserClass.user_id))
            .join(UserClass, Class.id == UserClass.class_id)
            .filter(Class.grade_id.in_(grade_ids))
            .group_by(Class.grade_id)
            .all()
        )
        return {gid: c for gid, c in rows}

    def _class_ids_for(self, grade_id: int) -> list[int]:
        return [row[0] for row in self.db.query(Class.id).filter(Class.grade_id == grade_id).all()]

    def _assignment_count_for_classes(self, class_ids: list[int]) -> int:
        if not class_ids:
            return 0
        return self.db.query(func.count(Assignment.id)).filter(Assignment.class_id.in_(class_ids)).scalar() or 0

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
