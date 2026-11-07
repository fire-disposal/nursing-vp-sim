"""院校（租户）作用域 —— 隔离的唯一强制点。

三件事只在这里定义，别处不许自己判断：

1. 谁跨院校（``school_id is None`` = 平台角色，例如 super_admin）；
2. 谁看全校（当前**视角**的 scope 为 ``tenant``，例如 admin/ops）；
3. 谁只看自己（``self``，例如 student）：只给空班级集合，端点自身按 ``user_id``
   收窄到"我"。教师是**校级**视角（``tenant``），班级只是校内业务分组/筛选，不再是
   授权边界。

数据作用域来自**视角声明**（``core/personas.py`` 的 ``PersonaDef.scope``），不是
从"有没有 ``user_manage``"反推。迁移前没有 ``user_personas`` 行的账号（legacy）
仍按旧逻辑推断，见 ``_legacy_scope``。

用法：端点依赖 ``Scope``，所有取他人数据的查询经 ``scope_query`` 收窄；写操作先用
``require_school`` 校验目标行的院校。越权一律 404（不暴露存在性），缺权限才是 403。

平台角色还可以用请求头 ``X-School-Scope`` 把**工作视图**收窄到某一所院校（见
``apply_school_scope``）：这是视图偏好，不是授权 —— 院校角色的院校是硬边界，
任何头都不能改。
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Annotated

from fastapi import Depends, Header

from core.deps import CurrentUser, DbSession
from core.exceptions import NotFoundError
from core.personas import is_super_admin, persona_scope
from models import Class, School

if TYPE_CHECKING:
    from sqlalchemy.orm import Query, Session

    from models import User


@dataclass(frozen=True)
class TenantScope:
    """解析后的可见范围。``school_id=None`` 表示跨院校（平台角色）。"""

    school_id: int | None
    #: ``None`` = 不按班级收窄；否则只允许这些班级（无视角账号的失败关闭空集）。
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
    """当前请求的可见范围。

    - 超管：默认全局；若请求头选择了院校工作视图（``active_school_id``）则收窄到该校；
    - 普通账号：取请求头选择的院校（已在鉴权层校验属于其授予集合），否则家院校；
      两者都没有 → **失败关闭**（空院校作用域），绝不回落到全局；
    - 其余按**当前生效视角**（``user.active_persona``）的 ``scope`` 生成院校边界；
    - 没有视角（未授予任何视角）→ 院校边界保留、class_ids 为空：能登录，但看不到数据。
    """
    active_school = getattr(user, "active_school_id", None)
    if is_super_admin(user):
        # 平台账号默认跨院校；顶栏选了一所学校时，工作视图收窄到该校。
        # 学生视角即使平台账号也只到本人（class_ids 空），不获得全校学生面。
        class_ids = frozenset() if persona_scope(user.active_persona) == "self" else None
        return TenantScope(school_id=active_school, class_ids=class_ids, user_id=user.id)
    school_id = active_school if active_school is not None else getattr(user, "school_id", None)
    if school_id is None:
        # 非平台账号没有院校：不能退化成全局。0 不匹配任何真实院校，读为空、写 404。
        return TenantScope(school_id=0, class_ids=frozenset(), user_id=user.id)

    scope = persona_scope(user.active_persona)
    if scope is None:
        return TenantScope(school_id=school_id, class_ids=frozenset(), user_id=user.id)
    if scope == "platform":
        # 平台级视角：院校轴无意义（只有平台账号能被授予它，校验在 resolve_view_persona）
        return TenantScope(school_id=None, class_ids=None, user_id=user.id)
    if scope == "tenant":
        return TenantScope(school_id=school_id, class_ids=None, user_id=user.id)
    # self：院校边界仍生效，但看不到任何他人班级；端点用 user_id 收窄到"我"
    return TenantScope(school_id=school_id, class_ids=frozenset(), user_id=user.id)


def apply_school_scope(scope: TenantScope, requested: str | None) -> TenantScope:
    """把平台角色的工作视图收窄到请求头指定的院校。

    只收窄、不放宽：
    - 院校角色（``scope.school_id`` 非空）的院校是硬边界 —— 头一律忽略；
    - 平台角色本来跨院校，``X-School-Scope`` 只是"我现在只看这一所"的视图偏好；
    - 非法值（非整数/非正数）按"未指定"处理，退回全部院校，不制造空白页。
    """
    if scope.school_id is not None or not requested:
        return scope
    try:
        school_id = int(requested)
    except ValueError:
        return scope
    if school_id <= 0:
        return scope
    return TenantScope(school_id=school_id, class_ids=scope.class_ids, user_id=scope.user_id)


def get_tenant_scope(
    current_user: CurrentUser,
    db: DbSession,
    requested_school: Annotated[str | None, Header(alias="X-School-Scope")] = None,
) -> TenantScope:
    return apply_school_scope(resolve_scope(db, current_user), requested_school)


Scope = Annotated[TenantScope, Depends(get_tenant_scope)]


def school_name_map(db: Session, school_ids: Iterable[int | None]) -> dict[int, str]:
    """院校 id → 名称。列表展示共用：缺 id 自动跳过，查不到的 id 不返回（调用方按空处理）。"""
    ids = {int(sid) for sid in school_ids if sid is not None}
    if not ids:
        return {}
    return {row[0]: row[1] for row in db.query(School.id, School.name).filter(School.id.in_(ids)).all()}


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
