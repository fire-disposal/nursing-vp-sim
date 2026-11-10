"""视角（persona）= 权限预设 —— 与 `core/permissions.py` 同构的单一真相。

视角由**代码拥有**：预设写在 `PERSONAS` 里，用户只持有"被授予了哪些视角"
（`user_school_personas` 表）。请求经 `X-View-Persona` 选择当前生效视角，生效权限 =
该视角的预设（`core/access.resolve_access`）。

角色（`roles`）仍是"一个人是什么"，视角是"这一刻他以什么身份操作"：
同一教师可被授予 `teacher` + `admin`，切换视角即切换权限，审计按视角留痕。

- 平台账号（`users.is_platform`）**派生**拥有全部视角，不写 `user_school_personas` 行。
- 没有任何授予的非平台账号：无视角、无权限（失败关闭），不再回落 `role_permissions`。
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

from core.permissions import PERMISSION_KEYS

if TYPE_CHECKING:
    from models import User

SUPER_ADMIN_ROLE = "super_admin"

#: 视角的数据作用域（`core/tenant.py::resolve_scope` 据此生成 `TenantScope`）：
#: - ``tenant``：本校全部（无班级收窄）；
#: - ``self``：本校 + 空班级集合（端点自身再按 ``user_id`` 收窄到"我"）。
#:
#: 班级是**校内业务分组**，不作为语境/授权轴；教师视角按校级（``tenant``）收窄，
#: 班级只影响页面筛选，不再决定数据边界。
PersonaScope = Literal["platform", "tenant", "self"]

#: 系统内置角色名 → 默认视角（自定义角色 → ``None``，由 `resolve_access` 取首个已授予视角）
DEFAULT_PERSONA_BY_ROLE: dict[str, str] = {
    "student": "student",
    "teacher": "teacher",
    "admin": "admin",
    SUPER_ADMIN_ROLE: "platform",
}


@dataclass(frozen=True)
class PersonaDef:
    """一个视角：稳定 key + 展示名 + 权限预设。"""

    key: str
    label: str
    permissions: tuple[str, ...]
    #: 该视角的数据可见范围（见 `PersonaScope`）。
    scope: PersonaScope
    #: 只能授予平台账号（``users.is_platform``）。院校账号拿到它会跨过院校边界。
    requires_platform_account: bool = False


#: 视角预设。**只在这里加权限**，不要在别处枚举角色权限。
PERSONAS: dict[str, PersonaDef] = {
    "student": PersonaDef(
        key="student",
        label="学生视角",
        scope="self",
        permissions=(
            "training_access",
            "qa_access",
        ),
    ),
    "teacher": PersonaDef(
        key="teacher",
        label="教师视角",
        scope="tenant",
        permissions=(
            "grade_class_manage",
            "case_manage",
            "score_review",
            "stats_view",
            "assignment_manage",
            "feedback_review",
            "export_data",
            "questionnaire_manage",
        ),
    ),
    "admin": PersonaDef(
        key="admin",
        label="管理员视角",
        scope="tenant",
        permissions=(
            "user_manage",
            "role_manage",
            "grade_class_manage",
            "case_manage",
            "score_review",
            "stats_view",
            "llm_monitor",
            "assignment_manage",
            "feedback_review",
            "export_data",
            "questionnaire_manage",
        ),
    ),
    # 运维看的是跨院校的系统面（密钥、审计、成本、诊断），不是某校的教学数据。
    # 院校账号持有它既解释不了作用域，也会在选校后四处 403；只授予平台账号。
    "ops": PersonaDef(
        key="ops",
        label="运维视角",
        scope="platform",
        requires_platform_account=True,
        permissions=(
            "llm_monitor",
            "api_manage",
            "audit_view",
            "audit_export",
            "feedback_review",
            "export_data",
        ),
    ),
    # 平台级：跨院校的管理页面与功能（院校管理、密钥、审计、成本、版本归因…）。
    # 只授予平台账号；`resolve_scope` 对它返回全局，院校切换器对它无意义。
    "platform": PersonaDef(
        key="platform",
        label="平台视角",
        scope="platform",
        requires_platform_account=True,
        permissions=(
            "school_manage",
            "api_manage",
            "audit_view",
            "audit_export",
            "llm_monitor",
            "export_data",
        ),
    ),
}

PERSONA_KEYS: tuple[str, ...] = tuple(PERSONAS)

_unknown_persona_perms = {p for d in PERSONAS.values() for p in d.permissions} - set(PERMISSION_KEYS)
if _unknown_persona_perms:
    raise ValueError(f"personas.py 使用了未在 core/permissions.py 定义的权限: {sorted(_unknown_persona_perms)}")


def persona_permissions(key: str) -> frozenset[str]:
    """视角的权限预设；未知视角 → 空集（调用方负责在授予集合内校验）。"""
    definition = PERSONAS.get(key)
    if definition is None:
        return frozenset()
    return frozenset(definition.permissions)


def platform_only_personas(personas: Iterable[str]) -> list[str]:
    """请求集合里只能授予平台账号的视角（未知 key 不在此判定）。"""
    return sorted({key for key in personas if PERSONAS.get(key) and PERSONAS[key].requires_platform_account})


def persona_scope(key: str | None) -> PersonaScope | None:
    """视角的数据作用域；未知视角 / 无视角 → ``None``。

    ``None`` = 没有可用的视角声明，调用方（`core/tenant.py::resolve_scope`）据此
    给出**失败关闭**的空数据面，而不是静默当成某种作用域。
    """
    definition = PERSONAS.get(key) if key else None
    if definition is None:
        return None
    return definition.scope


def grants_all_personas(user: User) -> bool:
    """超级管理员派生拥有全部视角（不落 `user_school_personas` 行）。"""
    return is_super_admin(user)


def is_super_admin(user: User) -> bool:
    """唯一的平台账号判定点：`users.is_platform`。"""
    return bool(getattr(user, "is_platform", False))


def default_persona_for(user: User) -> str | None:
    """默认视角：平台账号 → ``platform``；系统角色按 `DEFAULT_PERSONA_BY_ROLE`。

    返回 None 表示"没有角色给出的默认视角"，此时 `core/access.resolve_access` 取
    已授予视角里的第一个；两者都没有 → 无视角（无权限）。
    """
    if is_super_admin(user):
        return DEFAULT_PERSONA_BY_ROLE[SUPER_ADMIN_ROLE]
    role = getattr(user, "role", None)
    if role is None:
        return None
    return DEFAULT_PERSONA_BY_ROLE.get(role.name)
