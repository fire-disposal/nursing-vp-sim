"""班级成员（``ClassMembership``，表名沿用 ``user_class``）管理 + **可复用成员范围查询**。

读路径口径（唯一来源，供 scoreboard、assignments、teacher-summary 复用）：

- **学生名单 / 作业受众候选 / 班级排名 / 完成率** → ``member_role='student'`` 的成员；
- **teacher membership** 是「教师在哪个班」的数据来源。本轮只落地数据与 API，
  **不启用教师作用域强制**（不因缺 membership 拒绝访问），作用域强制留待下一阶段。

单用户多班级：一个用户可在多个班级各有一条成员记录，不存在主班级。
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session, joinedload

from core.audit import (
    ACTION_CLASS_MEMBERS_ADDED,
    ACTION_CLASS_MEMBERS_REMOVED,
    TARGET_TYPE_CLASS,
    record,
)
from core.deps import DbSession
from core.exceptions import NotFoundError, ValidationError
from core.pagination import paginate
from core.security import require_permission
from core.tenant import Scope, TenantScope, visible_class
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

# 审计 payload 里保留的 user_id 采样上限：名单纯计数，避免大批量导入把审计行撑爆
_AUDIT_USER_ID_SAMPLE = 20


def _assert_role(role: str | None) -> None:
    if role is not None and role not in MEMBER_ROLES:
        raise ValidationError(f"成员角色必须是 {'/'.join(MEMBER_ROLES)} 之一，收到 {role!r}")


def _target_class(db: Session, class_id: int, scope: TenantScope | None) -> Class:
    """写路径的班级归属校验：有 scope 按 scope（越权 404），没 scope 只保证班级存在。

    ``scope=None`` 给的是「调用方已自行校验归属」的复用入口（如 ``UserService``）；
    单校不变量与 scope 无关，两种情况都会在下面强制。
    """
    if scope is not None:
        return visible_class(db, scope, class_id)
    cls = db.get(Class, class_id)
    if cls is None:
        raise NotFoundError("班级不存在")
    return cls


def _assert_users_same_school(db: Session, cls: Class, user_ids: list[int]) -> list[int]:
    """校验待加入的用户都能进这个班，返回不存在的 user_id。

    单校不变量：成员关系不得跨院校。平台角色（``school_id IS NULL``）没有院校，
    进任何班级都会让「成员同校」失去意义，一律拒绝。一次报清全部违规者，避免前端逐个撞墙。
    """
    rows = db.query(User.id, User.username, User.school_id).filter(User.id.in_(user_ids)).all()
    found = {uid: (username, school_id) for uid, username, school_id in rows}
    problems: list[str] = []
    for uid in user_ids:
        if uid not in found:
            continue
        username, school_id = found[uid]
        if school_id is None:
            problems.append(f"用户 {username}(id={uid}) 未归属院校，不能加入班级「{cls.name}」")
        elif school_id != cls.school_id:
            problems.append(
                f"用户 {username}(id={uid}) 属于院校 {school_id}，与班级「{cls.name}」所在院校 {cls.school_id} 不一致"
            )
    if problems:
        raise ValidationError("；".join(problems))
    return [uid for uid in user_ids if uid not in found]


def _visible_class_ids(db: Session, class_ids: list[int], scope: TenantScope) -> list[int]:
    """把一批班级 id 收窄到作用域内（跨校/跨班静默剔除，不暴露存在性）。"""
    ids = [cid for cid in dict.fromkeys(class_ids) if scope.allows_class(cid)]
    if not ids:
        return []
    q = db.query(Class.id).filter(Class.id.in_(ids))
    if scope.school_id is not None:
        q = q.filter(Class.school_id == scope.school_id)
    return [row[0] for row in q.all()]


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


def member_counts(
    db: Session, class_ids: list[int], *, role: str | None = None, scope: TenantScope | None = None
) -> dict[int, int]:
    """批量统计班级成员数（按角色可选），用于列表页避免 N+1。

    给 ``scope`` 时只统计作用域内班级——计数也是数据，不能靠调用方自觉；
    调用方已在同一作用域里取到 ``class_ids``（见 ``ClassService._list_classes``）时可省略。
    """
    _assert_role(role)
    if scope is not None:
        class_ids = _visible_class_ids(db, class_ids, scope)
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


def upsert_members(
    db: Session,
    class_id: int,
    user_ids: list[int],
    *,
    member_role: str,
    scope: TenantScope | None = None,
) -> tuple[int, int, list[int]]:
    """批量加入/改角色（幂等）。

    返回 ``(added, updated, missing_user_ids)``：``updated`` 只统计角色被改写的成员。
    归属校验：班级必须在 ``scope`` 内（404）；用户必须与班级同院校（422），
    否则一旦写入就会造出跨院校的成员关系，单校不变量只能靠这里守。
    """
    _assert_role(member_role)
    wanted = list(dict.fromkeys(user_ids))
    if not wanted:
        return 0, 0, []
    cls = _target_class(db, class_id, scope)
    # 先整体校验再落库：一条跨校就整批拒绝，不留半截成员关系
    missing = _assert_users_same_school(db, cls, wanted)
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


def remove_members(db: Session, class_id: int, user_ids: list[int], *, scope: TenantScope | None = None) -> int:
    """从班级移除成员，返回实际删除行数。

    移除不做同院校校验：它只会减少成员关系，遗留的跨校脏数据也该能被删掉。
    """
    wanted = list(dict.fromkeys(user_ids))
    if not wanted:
        return 0
    _target_class(db, class_id, scope)
    return (
        db.query(ClassMembership)
        .filter(ClassMembership.class_id == class_id, ClassMembership.user_id.in_(wanted))
        .delete(synchronize_session=False)
    )


def delete_class_members(db: Session, class_id: int) -> int:
    """班级删除时清掉成员行（FK 是 SET NULL，这里显式删除避免留下悬空行）。

    无归属校验：调用方 ``ClassService.delete`` 必须先经 ``visible_class`` 拿到这个班。
    """
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


def member_query(
    db: Session,
    class_id: int,
    *,
    role: str | None = None,
    search: str | None = None,
    scope: TenantScope | None = None,
):
    """班级成员基础查询（含用户信息），供分页/详情共用。

    给 ``scope`` 时先做班级归属校验（越权 404）再查成员：成员列表是数据，不能只靠端点自觉。
    """
    _assert_role(role)
    if scope is not None:
        visible_class(db, scope, class_id)
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


def member_views(
    db: Session, class_id: int, *, role: str | None = None, scope: TenantScope | None = None
) -> list[MemberView]:
    """某班全部成员（详情页用；分页走 :class:`ClassMembershipService`）。"""
    return [to_member_view(m) for m in member_query(db, class_id, role=role, scope=scope).all()]


def member_item(v: MemberView) -> ClassMemberItem:
    """纯映射，本身无越权面：``v`` 必须来自已收窄的查询（``member_views`` / ``list_members``）。"""
    return ClassMemberItem(
        user_id=v.user_id,
        username=v.username,
        display_name=v.display_name,
        student_id=v.student_id,
        member_role=v.member_role,
        joined_at=v.joined_at,
    )


class ClassMembershipService:
    def __init__(self, db: Session, scope: TenantScope):
        self.db = db
        self.scope = scope

    def get_class(self, class_id: int) -> Class:
        """取作用域内的班级；跨院校/跨班一律 404（不暴露存在性）。"""
        return visible_class(self.db, self.scope, class_id)

    def list_members(
        self,
        class_id: int,
        *,
        role: str | None = None,
        search: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[MemberView], int]:
        rows, total = paginate(
            member_query(self.db, class_id, role=role, search=search, scope=self.scope), offset, limit
        )
        return [to_member_view(m) for m in rows], total

    def add_members(
        self,
        class_id: int,
        user_ids: list[int],
        member_role: str,
        *,
        request: Request | None = None,
    ) -> ClassMemberMutationResult:
        cls = self.get_class(class_id)
        # 与 upsert/remove 同一口径：先按去重后的名单计数，added+updated+skipped 恒等于 requested_count
        wanted = list(dict.fromkeys(user_ids))
        with unit_of_work(self.db, conflict_detail="成员变更冲突，请重试"):
            added, updated, missing = upsert_members(
                self.db, class_id, user_ids, member_role=member_role, scope=self.scope
            )
            record(
                self.db,
                action=ACTION_CLASS_MEMBERS_ADDED,
                target_type=TARGET_TYPE_CLASS,
                target_id=class_id,
                target_label=cls.name,
                request=request,
                payload={
                    "member_role": member_role,
                    "requested_count": len(wanted),
                    "added": added,
                    "updated": updated,
                    "skipped": len(missing),
                    # 名单纯计数即可；只留前 N 个 id 供追溯，避免大批量导入把审计行撑爆
                    "user_ids_sample": wanted[:_AUDIT_USER_ID_SAMPLE],
                },
            )
        return ClassMemberMutationResult(
            added=added,
            updated=updated,
            skipped=len(missing),
            errors=[f"用户 {uid} 不存在" for uid in missing],
        )

    def remove_members(
        self,
        class_id: int,
        user_ids: list[int],
        *,
        request: Request | None = None,
    ) -> ClassMemberMutationResult:
        cls = self.get_class(class_id)
        wanted = list(dict.fromkeys(user_ids))
        with unit_of_work(self.db, conflict_detail="成员变更冲突，请重试"):
            removed = remove_members(self.db, class_id, wanted, scope=self.scope)
            if removed:
                # removed=0 不落行：单删路由在此之后抛 NotFoundError，而审计已随本次 commit 落库，
                # 故"没删掉任何行"的空操作必须在写审计前就排除（与 ClassService.update 同一原则）。
                record(
                    self.db,
                    action=ACTION_CLASS_MEMBERS_REMOVED,
                    target_type=TARGET_TYPE_CLASS,
                    target_id=class_id,
                    target_label=cls.name,
                    request=request,
                    payload={
                        "requested_count": len(wanted),
                        "removed": removed,
                        "skipped": len(wanted) - removed,
                        "user_ids_sample": wanted[:_AUDIT_USER_ID_SAMPLE],
                    },
                )
        return ClassMemberMutationResult(removed=removed, skipped=len(wanted) - removed)


router = APIRouter(prefix="/classes", tags=["班级成员"])

_Manager = Annotated[User, Depends(require_permission("grade_class_manage"))]


@router.get("/{class_id}/members", response_model=PaginatedResponse[ClassMemberItem])
def list_class_members(
    class_id: int,
    current_user: _Manager,
    db: DbSession,
    scope: Scope,
    role: Annotated[str | None, Query(description="student|teacher")] = None,
    search: Annotated[str | None, Query(description="搜索用户名/姓名/学号")] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
):
    items, total = ClassMembershipService(db, scope).list_members(
        class_id, role=role, search=search, offset=offset, limit=limit
    )
    return PaginatedResponse(items=[member_item(v) for v in items], total=total, offset=offset, limit=limit)


@router.post("/{class_id}/members", response_model=ClassMemberMutationResult)
def add_class_members(
    class_id: int,
    body: ClassMemberAddRequest,
    current_user: _Manager,
    db: DbSession,
    scope: Scope,
    request: Request,
):
    return ClassMembershipService(db, scope).add_members(class_id, body.user_ids, body.member_role, request=request)


@router.post("/{class_id}/members/bulk-remove", response_model=ClassMemberMutationResult)
def remove_class_members(
    class_id: int,
    body: ClassMemberRemoveRequest,
    current_user: _Manager,
    db: DbSession,
    scope: Scope,
    request: Request,
):
    return ClassMembershipService(db, scope).remove_members(class_id, body.user_ids, request=request)


@router.delete("/{class_id}/members/{user_id}", response_model=DeleteResponse)
def remove_class_member(
    class_id: int,
    user_id: int,
    current_user: _Manager,
    db: DbSession,
    scope: Scope,
    request: Request,
):
    result = ClassMembershipService(db, scope).remove_members(class_id, [user_id], request=request)
    if result.removed == 0:
        raise NotFoundError("该用户不在这个班级里")
    return {"message": "成员已移出班级"}
