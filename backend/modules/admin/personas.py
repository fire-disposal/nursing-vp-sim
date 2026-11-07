"""视角授予 —— 谁能以哪些视角操作。

视角预设由代码拥有（``core/personas.py``），这里只管理 **授予关系**
（``user_personas`` 表）。三条规则：

1. **作用域**：目标用户必须落在调用者作用域内（跨校 → 404，不暴露存在性）；
   调用者是超管时跨校也允许，但目标必须真实存在。超管本身不可编辑（派生全视角）。
2. **提权**：调用者只能授予"其**当前生效视角**的权限能覆盖"的视角
   （``preset.permissions ⊆ actor 当前权限``）；超管例外。这是"授予"而不是"复制"，
   所以按视角整体比对，不做逐权限裁剪。
3. **留痕**：``ACTION_USER_PERSONAS_UPDATED``，payload 带 before/after 与 school_id。

视角变更后必须 ``clear_permission_cache(user_id)``：授予集合是进程内缓存的。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func

from core.audit import ACTION_USER_PERSONAS_UPDATED, TARGET_TYPE_USER, record
from core.deps import DbSession
from core.exceptions import AuthError, NotFoundError, ValidationError
from core.personas import PERSONA_KEYS, PERSONAS, is_super_admin
from core.security import clear_permission_cache, require_permission, resolve_view_persona
from core.tenant import Scope, TenantScope, scope_query
from core.unit_of_work import unit_of_work
from models import User, UserPersona
from schemas import (
    PersonaCatalogItem,
    UserPersonasResponse,
    UserPersonasUpdateRequest,
)

if TYPE_CHECKING:
    from sqlalchemy.orm import Query, Session


class PersonaService:
    def __init__(self, db: Session, scope: TenantScope):
        self.db = db
        self.scope = scope

    # ── 读取 ──

    def catalog(self) -> list[PersonaCatalogItem]:
        """全部视角 + 作用域内持有者数量（院校管理员只数本校）。"""
        counts = self._user_counts()
        return [
            PersonaCatalogItem(
                key=definition.key,
                label=definition.label,
                scope=definition.scope,
                permissions=list(definition.permissions),
                user_count=counts.get(definition.key, 0),
            )
            for definition in PERSONAS.values()
        ]

    def _scoped_user_query(self) -> Query:
        """作用域内的用户（``user_count`` 与目标校验共用同一谓词）。"""
        return scope_query(self.db.query(User), User.school_id, self.scope)

    def _user_counts(self) -> dict[str, int]:
        """按作用域统计每个视角的持有者数量。

        超管派生拥有全部视角但没有 ``user_personas`` 行 —— 它单独计入每个视角的
        ``user_count``（否则"全视角持有者"在目录里显示为 0 人，误导授权人）。
        """
        rows = (
            self._scoped_user_query()
            .join(UserPersona, UserPersona.user_id == User.id)
            .with_entities(UserPersona.persona, func.count(User.id))
            .group_by(UserPersona.persona)
            .all()
        )
        counts: dict[str, int] = {persona: cnt for persona, cnt in rows if persona in PERSONAS}
        super_admin_count = (
            self._scoped_user_query().filter(User.is_platform.is_(True)).with_entities(func.count(User.id)).scalar()
            or 0
        )
        if super_admin_count:
            for key in PERSONA_KEYS:
                counts[key] = counts.get(key, 0) + super_admin_count
        return counts

    def target(self, user_id: int, *, actor: User) -> User:
        """取作用域内的目标用户；跨校 / 不存在一律 404（超管不受作用域限制）。"""
        user = (
            self.db.query(User).filter(User.id == user_id).first()
            if is_super_admin(actor)
            else self._scoped_user_query().filter(User.id == user_id).first()
        )
        if user is None:
            raise NotFoundError("用户不存在")
        return user

    def granted(self, user: User) -> list[str]:
        """目标当前生效的视角：超管 = 全部（派生），否则读 ``user_personas``。"""
        if is_super_admin(user):
            return list(PERSONA_KEYS)
        rows = (
            self.db.query(UserPersona.persona)
            .filter(UserPersona.user_id == user.id)
            .order_by(UserPersona.persona)
            .all()
        )
        return [r[0] for r in rows if r[0] in PERSONAS]

    # ── 写入 ──

    def _grantable(self, actor: User) -> set[str] | None:
        """调用者可授予的视角集合；``None`` = 超管不限。

        判定是"视角预设 ⊆ 调用者当前生效权限"，所以权限覆盖不到的视角整块不可授予
        （不做逐权限裁剪 —— 半套视角不是视角）。
        """
        if is_super_admin(actor):
            return None
        actor_perms = _actor_permissions(self.db, actor)
        return {key for key in PERSONA_KEYS if set(PERSONAS[key].permissions) <= actor_perms}

    def replace(self, user_id: int, personas: list[str], *, actor: User, request: Request | None = None) -> list[str]:
        target = self.target(user_id, actor=actor)
        if is_super_admin(target):
            raise ValidationError("超级管理员的视角不可编辑（派生拥有全部视角）")

        unique = list(dict.fromkeys(personas))
        unknown = sorted(set(unique) - set(PERSONA_KEYS))
        if unknown:
            raise ValidationError(f"未知视角: {unknown}")
        # 平台级视角跨院校：只属于平台账号，绝不能被授予普通院校账号
        if "platform" in unique and not is_super_admin(target):
            raise ValidationError("平台视角只能授予平台账号")

        grantable = self._grantable(actor)
        if grantable is not None:
            escalated = sorted(set(unique) - grantable)
            if escalated:
                raise AuthError(f"无权授予以下视角: {escalated}", status_code=403)

        before = self.granted(target)
        with unit_of_work(self.db, conflict_detail="视角授予冲突"):
            self.db.query(UserPersona).filter(UserPersona.user_id == target.id).delete(synchronize_session="fetch")
            for key in unique:
                self.db.add(UserPersona(user_id=target.id, persona=key))
            record(
                self.db,
                action=ACTION_USER_PERSONAS_UPDATED,
                target_type=TARGET_TYPE_USER,
                target_id=target.id,
                target_label=target.username,
                request=request,
                payload={
                    "before": before,
                    "after": unique,
                    "school_id": target.school_id,
                    "actor_is_super_admin": is_super_admin(actor),
                },
            )
            self.db.flush()
        # 缓存是进程内的：改授予就必须失效，否则旧权限最多再放行一个 TTL
        clear_permission_cache(target.id)
        return unique


def _actor_permissions(db: Session, actor: User) -> frozenset[str]:
    """调用者当前生效权限。

    正常路径上 ``get_current_user`` 已按请求头视角写好 ``_permissions_cache``；
    缓存缺失（内部直接调用 / WebSocket 等）时回落到 ``resolve_view_persona``，
    绝不把"没解析到"当成"没有权限"而让授权端点静默全 403。
    """
    cached = getattr(actor, "_permissions_cache", None)
    if cached is not None:
        return frozenset(cached)
    _persona, perms = resolve_view_persona(db, actor)
    return frozenset(perms)


router = APIRouter(tags=["视角授权"])

_Grantor = Annotated[User, Depends(require_permission("role_manage"))]


@router.get("/personas", response_model=list[PersonaCatalogItem])
def list_personas(current_user: _Grantor, db: DbSession, scope: Scope) -> list[PersonaCatalogItem]:
    return PersonaService(db, scope).catalog()


@router.get("/users/{user_id}/personas", response_model=UserPersonasResponse)
def get_user_personas(user_id: int, current_user: _Grantor, db: DbSession, scope: Scope) -> UserPersonasResponse:
    service = PersonaService(db, scope)
    target = service.target(user_id, actor=current_user)
    return UserPersonasResponse(user_id=target.id, personas=service.granted(target))


@router.put("/users/{user_id}/personas", response_model=UserPersonasResponse)
def set_user_personas(
    user_id: int,
    req: UserPersonasUpdateRequest,
    current_user: _Grantor,
    db: DbSession,
    scope: Scope,
    request: Request,
) -> UserPersonasResponse:
    service = PersonaService(db, scope)
    granted = service.replace(user_id, req.personas, actor=current_user, request=request)
    return UserPersonasResponse(user_id=user_id, personas=granted)
