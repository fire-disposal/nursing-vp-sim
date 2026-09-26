"""班级成员（``ClassMembership``，表名沿用 ``user_class``）管理 + **可复用成员范围查询**。

读路径口径（唯一来源，供 admin/stats、scoreboard、assignments 复用）：

- **学生名单 / 作业受众候选 / 班级排名 / 完成率** → ``member_role='student'`` 的成员；
- **teacher membership** 是「教师在哪个班」的数据来源。本轮只落地数据与 API，
  **不启用教师作用域强制**（不因缺 membership 拒绝访问），作用域强制留待下一阶段。

单用户多班级：一个用户可在多个班级各有一条成员记录，不存在主班级。
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session, joinedload

from core.deps import DbSession
from core.exceptions import NotFoundError, ValidationError
from core.pagination import paginate
from core.security import require_permission
from core.unit_of_work import unit_of_work
from models import MEMBER_ROLE_STUDENT, MEMBER_ROLES, Class, ClassMembership, User
from schemas import (
    ClassMemberAddRequest,
    ClassMemberItem,
    ClassMemberMutationResult,
    ClassMemberRemoveRequest,
    DeleteResponse,
    PaginatedResponse,
)

# ─────────────────────────────  可复用成员范围查询  ─────────────────────────────


def _assert_role(role: str | None) -> None:
    if role is not None and role not in MEMBER_ROLES:
        raise ValidationError(f"成员角色必须是 {'/'.join(MEMBER_ROLES)} 之一，收到 {role!r}")


def member_id_query(class_id: int, *, role: str | None = None) -> Select:
    """某班成员的 ``user_id`` 子查询，可直接喂给 ``.in_()``。"""
    _assert_role(role)
    q = select(ClassMembership.user_id).where(ClassMembership.class_id == class_id)
    if role is not None:
        q = q.where(ClassMembership.member_role == role)
    return q


def student_member_id_query(class_id: int) -> Select:
    """本班**学生**成员的 ``user_id`` 子查询（学生名单口径）。"""
    return member_id_query(class_id, role=MEMBER_ROLE_STUDENT)


def teacher_member_id_query(class_id: int) -> Select:
    """本班**教师**成员的 ``user_id`` 子查询。"""
    return member_id_query(class_id, role="teacher")


def student_user_id_condition(column: Any, class_id: int):
    """``column.in_(本班学生成员)`` —— 传 ``User.id`` / ``TrainingRecord.user_id`` 皆可。"""
    return column.in_(student_member_id_query(class_id))


def member_ids(db: Session, class_id: int, *, role: str | None = None) -> list[int]:
    _assert_role(role)
    q = db.query(ClassMembership.user_id).filter(ClassMembership.class_id == class_id)
    if role is not None:
        q = q.filter(ClassMembership.member_role == role)
    return [row[0] for row in q.order_by(ClassMembership.user_id).all()]


def student_member_ids(db: Session, class_id: int) -> list[int]:
    """本班学生成员 user_id（有序）。学生名单 / 作业受众候选的唯一口径。"""
    return member_ids(db, class_id, role=MEMBER_ROLE_STUDENT)


def teacher_member_ids(db: Session, class_id: int) -> list[int]:
    return member_ids(db, class_id, role="teacher")


def member_class_ids(db: Session, user_id: int, *, role: str | None = None) -> list[int]:
    """该用户所属班级 id（可按成员角色过滤）。``class_id IS NULL`` 的悬空行不计入。"""
    _assert_role(role)
    q = db.query(ClassMembership.class_id).filter(
        ClassMembership.user_id == user_id, ClassMembership.class_id.isnot(None)
    )
    if role is not None:
        q = q.filter(ClassMembership.member_role == role)
    return [row[0] for row in q.order_by(ClassMembership.class_id).all()]


def student_class_ids(db: Session, user_id: int) -> list[int]:
    """该用户**以学生身份**所属的班级 id。"""
    return member_class_ids(db, user_id, role=MEMBER_ROLE_STUDENT)


def member_counts(db: Session, class_ids: list[int], *, role: str | None = None) -> dict[int, int]:
    """批量统计班级成员数（按角色可选），用于列表页避免 N+1。"""
    _assert_role(role)
    if not class_ids:
        return {}
    q = db.query(ClassMembership.class_id, func.count(ClassMembership.id)).filter(
        ClassMembership.class_id.in_(class_ids)
    )
    if role is not None:
        q = q.filter(ClassMembership.member_role == role)
    return {cid: count for cid, count in q.group_by(ClassMembership.class_id).all()}


def memberships_by_user(db: Session, user_ids: list[int]) -> dict[int, list[ClassMembership]]:
    """批量取成员关系（含班级），供用户列表/详情渲染，避免「只显示第一条」的老毛病。"""
    if not user_ids:
        return {}
    rows = (
        db.query(ClassMembership)
        .options(joinedload(ClassMembership.class_))
        .filter(ClassMembership.user_id.in_(user_ids))
        .order_by(ClassMembership.user_id, ClassMembership.class_id)
        .all()
    )
    out: dict[int, list[ClassMembership]] = {}
    for row in rows:
        out.setdefault(row.user_id, []).append(row)
    return out


def upsert_members(db: Session, class_id: int, user_ids: list[int], *, member_role: str) -> tuple[int, int, list[int]]:
    """批量加入/改角色（幂等）。

    返回 ``(added, updated, missing_user_ids)``：``updated`` 只统计角色被改写的成员。
    """
    _assert_role(member_role)
    wanted = list(dict.fromkeys(user_ids))
    if not wanted:
        return 0, 0, []
    existing_users = {uid for (uid,) in db.query(User.id).filter(User.id.in_(wanted)).all()}
    missing = [uid for uid in wanted if uid not in existing_users]
    present = {
        m.user_id: m
        for m in db.query(ClassMembership)
        .filter(ClassMembership.class_id == class_id, ClassMembership.user_id.in_(wanted))
        .all()
    }
    added = updated = 0
    for uid in wanted:
        if uid in missing:
            continue
        membership = present.get(uid)
        if membership is None:
            db.add(ClassMembership(user_id=uid, class_id=class_id, member_role=member_role))
            added += 1
        elif membership.member_role != member_role:
            membership.member_role = member_role
            updated += 1
    return added, updated, missing


def remove_members(db: Session, class_id: int, user_ids: list[int]) -> int:
    """从班级移除成员，返回实际删除行数。"""
    wanted = list(dict.fromkeys(user_ids))
    if not wanted:
        return 0
    return (
        db.query(ClassMembership)
        .filter(ClassMembership.class_id == class_id, ClassMembership.user_id.in_(wanted))
        .delete(synchronize_session=False)
    )


def delete_class_members(db: Session, class_id: int) -> int:
    """班级删除时清掉成员行（FK 是 SET NULL，这里显式删除避免留下悬空行）。"""
    return db.query(ClassMembership).filter(ClassMembership.class_id == class_id).delete(synchronize_session=False)


# ─────────────────────────────  成员管理 API  ─────────────────────────────


@dataclass
class MemberView:
    user_id: int
    username: str
    display_name: str
    student_id: str | None
    member_role: str
    joined_at: datetime


def member_query(db: Session, class_id: int, *, role: str | None = None, search: str | None = None):
    """班级成员基础查询（含用户信息），供分页/详情共用。"""
    _assert_role(role)
    q = (
        db.query(ClassMembership)
        .options(joinedload(ClassMembership.user))
        .join(User, User.id == ClassMembership.user_id)
        .filter(ClassMembership.class_id == class_id)
    )
    if role is not None:
        q = q.filter(ClassMembership.member_role == role)
    if search:
        term = f"%{search}%"
        q = q.filter(or_(User.username.ilike(term), User.display_name.ilike(term), User.student_id.ilike(term)))
    return q.order_by(ClassMembership.member_role, User.id)


def to_member_view(m: ClassMembership) -> MemberView:
    return MemberView(
        user_id=m.user_id,
        username=m.user.username if m.user else "",
        display_name=m.user.display_name if m.user else "",
        student_id=m.user.student_id if m.user else None,
        member_role=m.member_role,
        joined_at=m.joined_at,
    )


def member_views(db: Session, class_id: int, *, role: str | None = None) -> list[MemberView]:
    """某班全部成员（详情页用；分页走 :class:`ClassMembershipService`）。"""
    return [to_member_view(m) for m in member_query(db, class_id, role=role).all()]


def member_item(v: MemberView) -> ClassMemberItem:
    return ClassMemberItem(
        user_id=v.user_id,
        username=v.username,
        display_name=v.display_name,
        student_id=v.student_id,
        member_role=v.member_role,
        joined_at=v.joined_at,
    )


class ClassMembershipService:
    def __init__(self, db: Session):
        self.db = db

    def get_class(self, class_id: int) -> Class:
        cls = self.db.get(Class, class_id)
        if cls is None:
            raise NotFoundError("班级不存在")
        return cls

    def list_members(
        self,
        class_id: int,
        *,
        role: str | None = None,
        search: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[MemberView], int]:
        self.get_class(class_id)
        rows, total = paginate(member_query(self.db, class_id, role=role, search=search), offset, limit)
        return [to_member_view(m) for m in rows], total

    def add_members(self, class_id: int, user_ids: list[int], member_role: str) -> ClassMemberMutationResult:
        self.get_class(class_id)
        with unit_of_work(self.db, conflict_detail="成员变更冲突，请重试"):
            added, updated, missing = upsert_members(self.db, class_id, user_ids, member_role=member_role)
        return ClassMemberMutationResult(
            added=added,
            updated=updated,
            skipped=len(missing),
            errors=[f"用户 {uid} 不存在" for uid in missing],
        )

    def remove_members(self, class_id: int, user_ids: list[int]) -> ClassMemberMutationResult:
        self.get_class(class_id)
        wanted = list(dict.fromkeys(user_ids))
        with unit_of_work(self.db, conflict_detail="成员变更冲突，请重试"):
            removed = remove_members(self.db, class_id, wanted)
        return ClassMemberMutationResult(removed=removed, skipped=len(wanted) - removed)


router = APIRouter(prefix="/classes", tags=["班级成员"])

_Manager = Annotated[User, Depends(require_permission("grade_class_manage"))]


@router.get("/{class_id}/members", response_model=PaginatedResponse[ClassMemberItem])
def list_class_members(
    class_id: int,
    current_user: _Manager,
    db: DbSession,
    role: Annotated[str | None, Query(description="student|teacher")] = None,
    search: Annotated[str | None, Query(description="搜索用户名/姓名/学号")] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
):
    items, total = ClassMembershipService(db).list_members(
        class_id, role=role, search=search, offset=offset, limit=limit
    )
    return PaginatedResponse(items=[member_item(v) for v in items], total=total, offset=offset, limit=limit)


@router.post("/{class_id}/members", response_model=ClassMemberMutationResult)
def add_class_members(class_id: int, body: ClassMemberAddRequest, current_user: _Manager, db: DbSession):
    return ClassMembershipService(db).add_members(class_id, body.user_ids, body.member_role)


@router.post("/{class_id}/members/bulk-remove", response_model=ClassMemberMutationResult)
def remove_class_members(class_id: int, body: ClassMemberRemoveRequest, current_user: _Manager, db: DbSession):
    return ClassMembershipService(db).remove_members(class_id, body.user_ids)


@router.delete("/{class_id}/members/{user_id}", response_model=DeleteResponse)
def remove_class_member(class_id: int, user_id: int, current_user: _Manager, db: DbSession):
    result = ClassMembershipService(db).remove_members(class_id, [user_id])
    if result.removed == 0:
        raise NotFoundError("该用户不在这个班级里")
    return {"message": "成员已移出班级"}
