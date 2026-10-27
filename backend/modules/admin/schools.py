"""院校管理（租户）—— 平台级端点，仅 ``school_manage``（超级管理员）可用。

院校本身是隔离边界，所以这里**不做**按院校收窄：能进这个模块的人就是跨院校的人。
删除只允许删空院校（有班级或账号 → 409），避免把别人的数据变成孤儿行。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func

from core.audit import (
    ACTION_SCHOOL_CREATED,
    ACTION_SCHOOL_DELETED,
    ACTION_SCHOOL_UPDATED,
    TARGET_TYPE_SCHOOL,
    record,
)
from core.deps import DbSession
from core.exceptions import NotFoundError, ValidationError
from core.security import require_permission
from core.unit_of_work import unit_of_work
from models import Class, School, User
from schemas import DeleteSchoolResponse, SchoolCreate, SchoolResponse, SchoolUpdate

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

router = APIRouter(prefix="/schools", tags=["院校管理"])

_PlatformAdmin = Annotated[User, Depends(require_permission("school_manage"))]


class SchoolService:
    def __init__(self, db: Session):
        self.db = db

    def list_all(self) -> list[SchoolResponse]:
        rows = self.db.query(School).order_by(School.name).all()
        class_counts = {
            row[0]: row[1]
            for row in self.db.query(Class.school_id, func.count(Class.id)).group_by(Class.school_id).all()
        }
        user_counts = {
            row[0]: row[1]
            for row in self.db.query(User.school_id, func.count(User.id))
            .filter(User.school_id.isnot(None))
            .group_by(User.school_id)
            .all()
        }
        return [
            SchoolResponse(
                id=s.id,
                name=s.name,
                class_count=class_counts.get(s.id, 0),
                user_count=user_counts.get(s.id, 0),
                created_at=s.created_at,
            )
            for s in rows
        ]

    def create(self, name: str, *, request: Request | None = None) -> SchoolResponse:
        name = name.strip()
        if self.db.query(School.id).filter(School.name == name).first():
            raise ValidationError("院校名称已存在")
        with unit_of_work(self.db, conflict_detail="院校名称已存在"):
            school = School(name=name)
            self.db.add(school)
            self.db.flush()
            record(
                self.db,
                action=ACTION_SCHOOL_CREATED,
                target_type=TARGET_TYPE_SCHOOL,
                target_id=school.id,
                target_label=name,
                request=request,
                payload={"name": name},
            )
        return SchoolResponse(id=school.id, name=school.name, created_at=school.created_at)

    def update(self, school_id: int, name: str | None, *, request: Request | None = None) -> SchoolResponse:
        school = self._get(school_id)
        if name is None or name.strip() == school.name:
            return self._view(school)
        new_name = name.strip()
        if self.db.query(School.id).filter(School.name == new_name, School.id != school.id).first():
            raise ValidationError("院校名称已存在")
        before = school.name
        with unit_of_work(self.db, conflict_detail="院校名称已存在"):
            school.name = new_name
            self.db.flush()
            record(
                self.db,
                action=ACTION_SCHOOL_UPDATED,
                target_type=TARGET_TYPE_SCHOOL,
                target_id=school.id,
                target_label=new_name,
                request=request,
                payload={"name": {"before": before, "after": new_name}},
            )
        return self._view(school)

    def delete(self, school_id: int, *, request: Request | None = None) -> str:
        school = self._get(school_id)
        classes = self.db.query(func.count(Class.id)).filter(Class.school_id == school_id).scalar() or 0
        users = self.db.query(func.count(User.id)).filter(User.school_id == school_id).scalar() or 0
        if classes or users:
            raise ValidationError(f"院校「{school.name}」下仍有 {classes} 个班级、{users} 个账号，无法删除")
        name = school.name
        with unit_of_work(self.db, conflict_detail="无法删除"):
            record(
                self.db,
                action=ACTION_SCHOOL_DELETED,
                target_type=TARGET_TYPE_SCHOOL,
                target_id=school_id,
                target_label=name,
                request=request,
                payload={"name": name},
            )
            self.db.delete(school)
            self.db.flush()
        return name

    def _get(self, school_id: int) -> School:
        school = self.db.get(School, school_id)
        if school is None:
            raise NotFoundError("院校不存在")
        return school

    def _view(self, school: School) -> SchoolResponse:
        classes = self.db.query(func.count(Class.id)).filter(Class.school_id == school.id).scalar() or 0
        users = self.db.query(func.count(User.id)).filter(User.school_id == school.id).scalar() or 0
        return SchoolResponse(
            id=school.id, name=school.name, class_count=classes, user_count=users, created_at=school.created_at
        )


@router.get("", response_model=list[SchoolResponse])
def list_schools(current_user: _PlatformAdmin, db: DbSession):
    return SchoolService(db).list_all()


@router.post("", response_model=SchoolResponse)
def create_school(body: SchoolCreate, current_user: _PlatformAdmin, db: DbSession, request: Request):
    return SchoolService(db).create(body.name, request=request)


@router.put("/{school_id}", response_model=SchoolResponse)
def update_school(school_id: int, body: SchoolUpdate, current_user: _PlatformAdmin, db: DbSession, request: Request):
    return SchoolService(db).update(school_id, body.name, request=request)


@router.delete("/{school_id}", response_model=DeleteSchoolResponse)
def delete_school(school_id: int, current_user: _PlatformAdmin, db: DbSession, request: Request):
    name = SchoolService(db).delete(school_id, request=request)
    return DeleteSchoolResponse(message=f"已删除院校 {name}")
