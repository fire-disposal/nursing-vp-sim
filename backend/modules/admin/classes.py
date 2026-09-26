"""班级管理 —— cohort_label 取代 grades 归属（Grade 实体已退场）。

成员口径见 ``modules/admin/class_memberships.py``：学生/教师计数都来自
``member_role='student'`` / ``'teacher'`` 的成员，与用户列表/作业受众候选同一口径。
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.deps import DbSession
from core.exceptions import NotFoundError, ValidationError
from core.security import require_permission
from core.unit_of_work import unit_of_work
from models import MEMBER_ROLE_STUDENT, MEMBER_ROLE_TEACHER, Assignment, Class, User
from modules.admin.class_memberships import (
    MemberView,
    delete_class_members,
    member_counts,
    member_item,
    member_views,
)
from schemas import ClassCreate, ClassDetailResponse, ClassResponse, ClassUpdate, DeleteResponse


@dataclass
class ClassView:
    id: int
    name: str
    cohort_label: str
    created_at: datetime
    student_count: int = 0
    teacher_count: int = 0
    assignment_count: int = 0
    members: list[MemberView] = field(default_factory=list)


class ClassService:
    def __init__(self, db: Session):
        self.db = db

    def list_all(self, cohort_label: str | None = None) -> list[ClassView]:
        classes = self._list_classes(cohort_label)
        class_ids = [c.id for c in classes]
        students = member_counts(self.db, class_ids, role=MEMBER_ROLE_STUDENT)
        teachers = member_counts(self.db, class_ids, role=MEMBER_ROLE_TEACHER)
        assignments = self._assignment_counts(class_ids)
        return [
            ClassView(
                id=c.id,
                name=c.name,
                cohort_label=c.cohort_label,
                created_at=c.created_at,
                student_count=students.get(c.id, 0),
                teacher_count=teachers.get(c.id, 0),
                assignment_count=assignments.get(c.id, 0),
            )
            for c in classes
        ]

    def get(self, class_id: int) -> ClassView:
        cls = self._get(class_id)
        members = member_views(self.db, class_id)
        return ClassView(
            id=cls.id,
            name=cls.name,
            cohort_label=cls.cohort_label,
            created_at=cls.created_at,
            student_count=sum(1 for m in members if m.member_role == MEMBER_ROLE_STUDENT),
            teacher_count=sum(1 for m in members if m.member_role == MEMBER_ROLE_TEACHER),
            assignment_count=self._assignment_count(class_id),
            members=members,
        )

    def create(self, name: str, cohort_label: str = "") -> ClassView:
        if self._name_exists(cohort_label, name):
            raise ValidationError("该 cohort 下班级名称重复")
        with unit_of_work(self.db, conflict_detail="该 cohort 下班级名称重复"):
            cls = Class(name=name, cohort_label=cohort_label)
            self.db.add(cls)
            self.db.flush()
        return ClassView(id=cls.id, name=cls.name, cohort_label=cls.cohort_label, created_at=cls.created_at)

    def update(self, class_id: int, *, name: str | None = None, cohort_label: str | None = None) -> ClassView:
        cls = self._get(class_id)
        new_name = name if name is not None else cls.name
        new_cohort = cohort_label if cohort_label is not None else cls.cohort_label
        changed = new_name != cls.name or new_cohort != cls.cohort_label
        if changed and self._name_exists(new_cohort, new_name, exclude_id=cls.id):
            raise ValidationError("该 cohort 下班级名称重复")
        if changed:
            with unit_of_work(self.db, conflict_detail="该 cohort 下班级名称重复"):
                cls.name = new_name
                cls.cohort_label = new_cohort
                self.db.flush()
        return ClassView(
            id=cls.id,
            name=cls.name,
            cohort_label=cls.cohort_label,
            created_at=cls.created_at,
            student_count=len(member_views(self.db, class_id, role=MEMBER_ROLE_STUDENT)),
            teacher_count=len(member_views(self.db, class_id, role=MEMBER_ROLE_TEACHER)),
            assignment_count=self._assignment_count(class_id),
        )

    def delete(self, class_id: int) -> str:
        cls = self._get(class_id)
        if self._assignment_count(class_id) > 0:
            raise ValidationError("该班级下仍有作业，无法删除。请先删除或改派相关作业。")
        name = cls.name
        with unit_of_work(self.db, conflict_detail="无法删除"):
            # FK 是 ON DELETE SET NULL；这里显式清掉成员行，避免留下 class_id 悬空的成员记录
            delete_class_members(self.db, class_id)
            self.db.delete(cls)
            self.db.flush()
        return name

    def _get(self, class_id: int) -> Class:
        cls = self.db.get(Class, class_id)
        if cls is None:
            raise NotFoundError("班级不存在")
        return cls

    def _list_classes(self, cohort_label: str | None = None) -> list[Class]:
        q = self.db.query(Class)
        if cohort_label is not None:
            q = q.filter(Class.cohort_label == cohort_label)
        return q.order_by(Class.cohort_label, Class.name).all()

    def _name_exists(self, cohort_label: str, name: str, exclude_id: int | None = None) -> bool:
        q = self.db.query(Class.id).filter(Class.cohort_label == cohort_label, Class.name == name)
        if exclude_id is not None:
            q = q.filter(Class.id != exclude_id)
        return bool(self.db.query(q.exists()).scalar())

    def _assignment_count(self, class_id: int) -> int:
        return self.db.query(func.count(Assignment.id)).filter(Assignment.class_id == class_id).scalar() or 0

    def _assignment_counts(self, class_ids: list[int]) -> dict[int, int]:
        if not class_ids:
            return {}
        rows = (
            self.db.query(Assignment.class_id, func.count(Assignment.id))
            .filter(Assignment.class_id.in_(class_ids))
            .group_by(Assignment.class_id)
            .all()
        )
        return {cid: count for cid, count in rows}


router = APIRouter(prefix="/classes", tags=["班级管理"])

_Manager = Annotated[User, Depends(require_permission("grade_class_manage"))]


@router.get("", response_model=list[ClassResponse])
def list_classes(
    current_user: _Manager,
    db: DbSession,
    cohort_label: Annotated[str | None, Query(description="届/年级标签精确过滤")] = None,
):
    return [ClassResponse.model_validate(v) for v in ClassService(db).list_all(cohort_label=cohort_label)]


@router.get("/{class_id}", response_model=ClassDetailResponse)
def get_class(class_id: int, current_user: _Manager, db: DbSession):
    view = ClassService(db).get(class_id)
    return ClassDetailResponse(
        **ClassResponse.model_validate(view).model_dump(),
        members=[member_item(m) for m in view.members],
    )


@router.post("", response_model=ClassResponse)
def create_class(body: ClassCreate, current_user: _Manager, db: DbSession):
    return ClassResponse.model_validate(ClassService(db).create(body.name, body.cohort_label))


@router.put("/{class_id}", response_model=ClassResponse)
def update_class(class_id: int, body: ClassUpdate, current_user: _Manager, db: DbSession):
    return ClassResponse.model_validate(
        ClassService(db).update(class_id, name=body.name, cohort_label=body.cohort_label)
    )


@router.delete("/{class_id}", response_model=DeleteResponse)
def delete_class(class_id: int, current_user: _Manager, db: DbSession):
    name = ClassService(db).delete(class_id)
    return {"message": f"已删除班级 {name}"}
