"""视角授予 —— 谁能以哪些视角操作。

视角预设由代码拥有（``core/personas.py``），这里只管理 **授予关系**
（``user_school_personas`` 表）。三条规则：

1. **作用域**：目标用户必须落在调用者作用域内（跨校 → 404，不暴露存在性）；
   调用者是超管时跨校也允许，但目标必须真实存在。超管本身不可编辑（派生全视角）。
2. **提权**：调用者只能授予"其**当前生效视角**的权限能覆盖"的视角
   （``preset.permissions ⊆ actor 当前权限``）；超管例外。这是"授予"而不是"复制"，
   所以按视角整体比对，不做逐权限裁剪。
3. **留痕**：``ACTION_USER_PERSONAS_UPDATED``，payload 带 before/after 与 school_id。

视角变更后必须 ``clear_access_cache(user_id)``：授予集合是进程内缓存的。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func

from core.access import clear_access_cache, grantable_personas, granted_personas
from core.access import replace_personas as replace_school_personas
from core.audit import ACTION_USER_PERSONAS_UPDATED, TARGET_TYPE_USER, record
from core.deps import DbSession
from core.exceptions import AuthError, NotFoundError, ValidationError
from core.personas import PERSONA_KEYS, PERSONAS, is_super_admin
from core.security import require_permission
from core.tenant import Scope, TenantScope, scope_query
from core.unit_of_work import unit_of_work
from models import School, User, UserSchoolPersona
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

    def catalog(self, actor: User) -> list[PersonaCatalogItem]:
        """全部视角 + 作用域内持有者数量（院校管理员只数本校）。

        ``grantable`` 按调用者**当前生效权限**判定：目录是同一份，能不能授予随视角变。
        """
        counts = self._user_counts()
        grantable = None if is_super_admin(actor) else grantable_personas(actor)
        return [
            PersonaCatalogItem(
                key=definition.key,
                label=definition.label,
                scope=definition.scope,
                permissions=list(definition.permissions),
                user_count=counts.get(definition.key, 0),
                grantable=grantable is None or definition.key in grantable,
            )
            for definition in PERSONAS.values()
        ]

    def _scoped_user_query(self) -> Query:
        """作用域内的用户（``user_count`` 与目标校验共用同一谓词）。"""
        return scope_query(self.db.query(User), User.school_id, self.scope)

    def _user_counts(self) -> dict[str, int]:
        """按作用域统计每个视角的持有者数量。

        超管派生拥有全部视角但没有 ``user_school_personas`` 行 —— 它单独计入每个视角的
        ``user_count``（否则"全视角持有者"在目录里显示为 0 人，误导授权人）。
        """
        q = self.db.query(UserSchoolPersona.persona, func.count(func.distinct(UserSchoolPersona.user_id)))
        if self.scope.school_id is not None:
            q = q.filter(UserSchoolPersona.school_id == self.scope.school_id)
        rows = q.group_by(UserSchoolPersona.persona).all()
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

    def granted(self, user: User, school_id: int | None = None) -> list[str]:
        """目标在某校的视角：超管 = 全部（派生），否则读家院校 + 附加院校授予。"""
        if is_super_admin(user):
            return list(PERSONA_KEYS)
        active_school = school_id if school_id is not None else user.school_id
        return sorted(granted_personas(self.db, user, active_school))

    # ── 写入 ──

    def _grant_target_school(self, target: User, school_id: int | None, actor: User) -> int | None:
        """授予动作落在哪所学校：家院校，或作用域内真实存在的附加院校。"""
        if school_id is None or school_id == target.school_id:
            return target.school_id
        # 平台账号可以跨校授予；院校管理员只能本校。
        if not is_super_admin(actor) and self.scope.school_id is not None and school_id != self.scope.school_id:
            raise NotFoundError("院校不存在")
        if self.db.get(School, school_id) is None:
            raise NotFoundError("院校不存在")
        return school_id

    def _grantable(self, actor: User) -> set[str] | None:
        """调用者可授予的视角集合；``None`` = 超管不限。

        判定是"视角预设 ⊆ 调用者当前生效权限"，所以权限覆盖不到的视角整块不可授予
        （不做逐权限裁剪 —— 半套视角不是视角）。
        """
        if is_super_admin(actor):
            return None
        return set(grantable_personas(actor))

    def replace(
        self,
        user_id: int,
        personas: list[str],
        *,
        actor: User,
        request: Request | None = None,
        school_id: int | None = None,
    ) -> list[str]:
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
        active_school = self._grant_target_school(target, school_id, actor)
        grantable = self._grantable(actor)
        if grantable is not None:
            escalated = sorted(set(unique) - grantable)
            if escalated:
                raise AuthError(f"无权授予以下视角: {escalated}", status_code=403)

        if active_school is None:
            raise ValidationError("该账号没有院校归属，不能授予院校视角")
        if "student" in unique and active_school != target.school_id:
            raise ValidationError("学生视角暂只支持家院校（跨校学号/名单口径尚未开放）")
        before = self.granted(target, active_school)
        with unit_of_work(self.db, conflict_detail="视角授予冲突"):
            replace_school_personas(self.db, target.id, active_school, unique)
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
                    "school_id": active_school,
                    "actor_is_super_admin": is_super_admin(actor),
                },
            )
            self.db.flush()
        # 缓存是进程内的：改授予就必须失效，否则旧权限最多再放行一个 TTL
        clear_access_cache(target.id)
        return unique


router = APIRouter(tags=["视角授权"])

_Grantor = Annotated[User, Depends(require_permission("role_manage"))]


@router.get("/personas", response_model=list[PersonaCatalogItem])
def list_personas(current_user: _Grantor, db: DbSession, scope: Scope) -> list[PersonaCatalogItem]:
    return PersonaService(db, scope).catalog(current_user)


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


@router.get("/users/{user_id}/personas/schools/{school_id}", response_model=UserPersonasResponse)
def get_user_school_personas(
    user_id: int, school_id: int, current_user: _Grantor, db: DbSession, scope: Scope
) -> UserPersonasResponse:
    service = PersonaService(db, scope)
    target = service.target(user_id, actor=current_user)
    return UserPersonasResponse(user_id=target.id, personas=service.granted(target, school_id))


@router.put("/users/{user_id}/personas/schools/{school_id}", response_model=UserPersonasResponse)
def set_user_school_personas(
    user_id: int,
    school_id: int,
    req: UserPersonasUpdateRequest,
    current_user: _Grantor,
    db: DbSession,
    scope: Scope,
    request: Request,
) -> UserPersonasResponse:
    """给用户在**指定院校**授予视角（家院校的授予仍走上面的默认端点）。"""
    service = PersonaService(db, scope)
    granted = service.replace(user_id, req.personas, actor=current_user, request=request, school_id=school_id)
    return UserPersonasResponse(user_id=user_id, personas=granted)
