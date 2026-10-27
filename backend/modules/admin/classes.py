"""班级管理 —— cohort_label 取代 grades 归属（Grade 实体已退场）。

成员口径见 ``modules/admin/class_memberships.py``：学生/教师计数都来自
``member_role='student'`` / ``'teacher'`` 的成员，与用户列表/作业受众候选同一口径。
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from core.audit import (
    ACTION_CLASS_CREATED,
    ACTION_CLASS_DELETED,
    ACTION_CLASS_UPDATED,
    TARGET_TYPE_CLASS,
    record,
)
from core.deps import DbSession
from core.exceptions import ValidationError
from core.security import require_permission
from core.tenant import Scope, TenantScope, visible_class, writable_school_id
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
    school_id: int
    school_name: str
    cohort_label: str
    created_at: datetime
    student_count: int = 0
    teacher_count: int = 0
    assignment_count: int = 0
    members: list[MemberView] = field(default_factory=list)


class ClassService:
    def __init__(self, db: Session, scope: TenantScope):
        self.db = db
        self.scope = scope

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
                school_id=c.school_id,
                school_name=c.school.name if c.school else "",
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
            school_id=cls.school_id,
            school_name=cls.school.name if cls.school else "",
            cohort_label=cls.cohort_label,
            created_at=cls.created_at,
            student_count=sum(1 for m in members if m.member_role == MEMBER_ROLE_STUDENT),
            teacher_count=sum(1 for m in members if m.member_role == MEMBER_ROLE_TEACHER),
            assignment_count=self._assignment_count(class_id),
            members=members,
        )

    def create(
        self,
        name: str,
        cohort_label: str = "",
        *,
        school_id: int | None = None,
        request: Request | None = None,
    ) -> ClassView:
        school_id = writable_school_id(self.scope, school_id)
        if self._name_exists(school_id, cohort_label, name):
            raise ValidationError("该院校同一届别下班级名称重复")
        with unit_of_work(self.db, conflict_detail="该院校同一届别下班级名称重复"):
            cls = Class(name=name, cohort_label=cohort_label, school_id=school_id)
            self.db.add(cls)
            self.db.flush()
            record(
                self.db,
                action=ACTION_CLASS_CREATED,
                target_type=TARGET_TYPE_CLASS,
                target_id=cls.id,
                target_label=name,
                request=request,
                payload={"name": name, "cohort_label": cohort_label, "school_id": school_id},
            )
        return ClassView(
            id=cls.id,
            name=cls.name,
            school_id=cls.school_id,
            school_name=cls.school.name if cls.school else "",
            cohort_label=cls.cohort_label,
            created_at=cls.created_at,
        )

    def update(
        self,
        class_id: int,
        *,
        name: str | None = None,
        cohort_label: str | None = None,
        school_id: int | None = None,
        request: Request | None = None,
    ) -> ClassView:
        cls = self._get(class_id)
        new_name = name if name is not None else cls.name
        new_cohort = cohort_label if cohort_label is not None else cls.cohort_label
        # 只有平台角色能搬院校；院校管理员的改动请求被忽略（不能把自己班搬到别人校）
        new_school = (
            cls.school_id
            if self.scope.school_id is not None
            else (school_id if school_id is not None else cls.school_id)
        )
        changed = new_name != cls.name or new_cohort != cls.cohort_label or new_school != cls.school_id
        if changed and self._name_exists(new_school, new_cohort, new_name, exclude_id=cls.id):
            raise ValidationError("该院校同一届别下班级名称重复")
        if changed:
            before_name, before_cohort, before_school = cls.name, cls.cohort_label, cls.school_id
            with unit_of_work(self.db, conflict_detail="该院校同一届别下班级名称重复"):
                cls.name = new_name
                cls.cohort_label = new_cohort
                cls.school_id = new_school
                self.db.flush()
                # 只在确有变化时落行：空操作不留痕（before 在赋值前已取出，不依赖 ORM 脏状态）
                record(
                    self.db,
                    action=ACTION_CLASS_UPDATED,
                    target_type=TARGET_TYPE_CLASS,
                    target_id=cls.id,
                    target_label=new_name,
                    request=request,
                    payload={
                        "name": {"before": before_name, "after": new_name},
                        "cohort_label": {"before": before_cohort, "after": new_cohort},
                        "school_id": {"before": before_school, "after": new_school},
                    },
                )
        return ClassView(
            id=cls.id,
            name=cls.name,
            school_id=cls.school_id,
            school_name=cls.school.name if cls.school else "",
            cohort_label=cls.cohort_label,
            created_at=cls.created_at,
            student_count=len(member_views(self.db, class_id, role=MEMBER_ROLE_STUDENT)),
            teacher_count=len(member_views(self.db, class_id, role=MEMBER_ROLE_TEACHER)),
            assignment_count=self._assignment_count(class_id),
        )

    def delete(self, class_id: int, *, request: Request | None = None) -> str:
        cls = self._get(class_id)
        if self._assignment_count(class_id) > 0:
            raise ValidationError("该班级下仍有作业，无法删除。请先删除或改派相关作业。")
        name = cls.name
        cohort_label = cls.cohort_label
        with unit_of_work(self.db, conflict_detail="无法删除"):
            # FK 是 ON DELETE SET NULL；这里显式清掉成员行，避免留下 class_id 悬空的成员记录
            removed_members = delete_class_members(self.db, class_id)
            record(
                self.db,
                action=ACTION_CLASS_DELETED,
                target_type=TARGET_TYPE_CLASS,
                target_id=class_id,
                target_label=name,
                request=request,
                payload={"name": name, "cohort_label": cohort_label, "removed_members": removed_members},
            )
            self.db.delete(cls)
            self.db.flush()
        return name

    def _get(self, class_id: int) -> Class:
        """取作用域内的班级；跨院校/跨班一律 404（不暴露存在性）。"""
        return visible_class(self.db, self.scope, class_id)

    def _list_classes(self, cohort_label: str | None = None) -> list[Class]:
        q = self.db.query(Class).options(joinedload(Class.school))
        if self.scope.school_id is not None:
            q = q.filter(Class.school_id == self.scope.school_id)
        if self.scope.class_ids is not None:
            q = q.filter(Class.id.in_(self.scope.class_ids or {-1}))
        if cohort_label is not None:
            q = q.filter(Class.cohort_label == cohort_label)
        return q.order_by(Class.cohort_label, Class.name).all()

    def _name_exists(self, school_id: int, cohort_label: str, name: str, exclude_id: int | None = None) -> bool:
        q = self.db.query(Class.id).filter(
            Class.school_id == school_id, Class.cohort_label == cohort_label, Class.name == name
        )
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
    scope: Scope,
    cohort_label: Annotated[str | None, Query(description="届/年级标签精确过滤")] = None,
):
    return [ClassResponse.model_validate(v) for v in ClassService(db, scope).list_all(cohort_label=cohort_label)]


@router.get("/{class_id}", response_model=ClassDetailResponse)
def get_class(class_id: int, current_user: _Manager, db: DbSession, scope: Scope):
    view = ClassService(db, scope).get(class_id)
    return ClassDetailResponse(
        **ClassResponse.model_validate(view).model_dump(),
        members=[member_item(m) for m in view.members],
    )


@router.post("", response_model=ClassResponse)
def create_class(body: ClassCreate, current_user: _Manager, db: DbSession, scope: Scope, request: Request):
    return ClassResponse.model_validate(
        ClassService(db, scope).create(body.name, body.cohort_label, school_id=body.school_id, request=request)
    )


@router.put("/{class_id}", response_model=ClassResponse)
def update_class(
    class_id: int, body: ClassUpdate, current_user: _Manager, db: DbSession, scope: Scope, request: Request
):
    return ClassResponse.model_validate(
        ClassService(db, scope).update(
            class_id,
            name=body.name,
            cohort_label=body.cohort_label,
            school_id=body.school_id,
            request=request,
        )
    )


@router.delete("/{class_id}", response_model=DeleteResponse)
def delete_class(class_id: int, current_user: _Manager, db: DbSession, scope: Scope, request: Request):
    name = ClassService(db, scope).delete(class_id, request=request)
    return {"message": f"已删除班级 {name}"}
