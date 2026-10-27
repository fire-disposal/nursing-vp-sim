"""院校（租户）作用域 —— 隔离的唯一强制点。

三件事只在这里定义，别处不许自己判断：

1. 谁跨院校（``school_id is None`` = 平台角色，例如 super_admin）；
2. 谁看全校（有 ``user_manage`` 的院校管理员）；
3. 谁只看自己任教班（无 ``user_manage`` 但有 teacher 成员关系的人）。

用法：端点依赖 ``Scope``，所有取他人数据的查询经 ``scope_query`` 收窄；写操作先用
``require_school`` 校验目标行的院校。越权一律 404（不暴露存在性），缺权限才是 403。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Annotated

from fastapi import Depends

from core.deps import CurrentUser, DbSession
from core.exceptions import NotFoundError
from models import MEMBER_ROLE_TEACHER, Class, ClassMembership, User

if TYPE_CHECKING:
    from sqlalchemy.orm import Query, Session


@dataclass(frozen=True)
class TenantScope:
    """解析后的可见范围。``school_id=None`` 表示跨院校（平台角色）。"""

    school_id: int | None
    #: ``None`` = 不按班级收窄；否则只允许这些班级（教师视角）。
    class_ids: frozenset[int] | None
    user_id: int

    @property
    def is_global(self) -> bool:
        return self.school_id is None

    def allows_class(self, class_id: int) -> bool:
        return self.class_ids is None or class_id in self.class_ids


def platform_scope(user_id: int = 0) -> TenantScope:
    """跨院校作用域 —— 测试与后台任务用的显式“平台视角”，不要在生产端点里图省事用它。"""
    return TenantScope(school_id=None, class_ids=None, user_id=user_id)


def resolve_scope(db: Session, user: User) -> TenantScope:
    if user.school_id is None:
        return TenantScope(school_id=None, class_ids=None, user_id=user.id)
    if user.has_permission("user_manage"):
        return TenantScope(school_id=user.school_id, class_ids=None, user_id=user.id)
    rows = (
        db.query(ClassMembership.class_id)
        .filter(
            ClassMembership.user_id == user.id,
            ClassMembership.member_role == MEMBER_ROLE_TEACHER,
            ClassMembership.class_id.isnot(None),
        )
        .all()
    )
    return TenantScope(
        school_id=user.school_id,
        class_ids=frozenset(r[0] for r in rows if r[0] is not None),
        user_id=user.id,
    )


def get_tenant_scope(current_user: CurrentUser, db: DbSession) -> TenantScope:
    return resolve_scope(db, current_user)


Scope = Annotated[TenantScope, Depends(get_tenant_scope)]


def scope_query(query: Query, column, scope: TenantScope) -> Query:
    """按院校收窄一个查询。列由调用方给出（``User.school_id`` / ``Class.school_id`` 等）。"""
    if scope.school_id is None:
        return query
    return query.filter(column == scope.school_id)


def require_school(scope: TenantScope, school_id: int | None, *, what: str = "该资源") -> None:
    """跨院校访问一律 404：不告诉调用方“存在但你看不到”。"""
    if scope.school_id is None:
        return
    if school_id is None or school_id != scope.school_id:
        raise NotFoundError(f"{what}不存在")


def writable_school_id(scope: TenantScope, requested: int | None) -> int:
    """写入时的院校归属：院校管理员强制本校；平台角色必须显式给出。"""
    if scope.school_id is not None:
        if requested is not None and requested != scope.school_id:
            raise NotFoundError("目标院校不存在")
        return scope.school_id
    if requested is None:
        raise NotFoundError("需要指定院校")
    return requested


def visible_class(db: Session, scope: TenantScope, class_id: int | None) -> Class:
    """取一个在作用域内的班级，否则 404（写路径与按班级查询共用）。"""
    cls = db.get(Class, class_id) if class_id is not None else None
    if cls is None:
        raise NotFoundError("班级不存在")
    if scope.school_id is not None and cls.school_id != scope.school_id:
        raise NotFoundError("班级不存在")
    if not scope.allows_class(cls.id):
        raise NotFoundError("班级不存在")
    return cls
