"""视角（persona）= 权限预设 —— 与 `core/permissions.py` 同构的单一真相。

视角由**代码拥有**：预设写在 `PERSONAS` 里，用户只持有"被授予了哪些视角"
（`user_personas` 表）。请求经 `X-View-Persona` 选择当前生效视角，生效权限 =
该视角的预设（`core/security.resolve_view_persona`）。

角色（`roles`）仍是"一个人是什么"，视角是"这一刻他以什么身份操作"：
同一教师可被授予 `teacher` + `admin`，切换视角即切换权限，审计按视角留痕。

- 超级管理员（`role.name == "super_admin"`）**派生**拥有全部视角，不写 `user_personas` 行。
- 迁移前的老数据（无 persona 行且非超管）走 legacy `role_permissions`，见 `LEGACY` 说明
  在 `core/security.resolve_view_persona` 里的分支。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from core.permissions import PERMISSION_KEYS

if TYPE_CHECKING:
    from models import User

SUPER_ADMIN_ROLE = "super_admin"

#: 系统内置角色名 → 默认视角（自定义角色的默认视角 = legacy role_permissions）
DEFAULT_PERSONA_BY_ROLE: dict[str, str] = {
    "student": "student",
    "teacher": "teacher",
    "admin": "admin",
    SUPER_ADMIN_ROLE: "admin",
}


@dataclass(frozen=True)
class PersonaDef:
    """一个视角：稳定 key + 展示名 + 权限预设。"""

    key: str
    label: str
    permissions: tuple[str, ...]


#: 视角预设。**只在这里加权限**，不要在别处枚举角色权限。
PERSONAS: dict[str, PersonaDef] = {
    "student": PersonaDef(
        key="student",
        label="学生视角",
        permissions=(
            "training_access",
            "scenario_training",
            "qa_access",
        ),
    ),
    "teacher": PersonaDef(
        key="teacher",
        label="教师视角",
        permissions=(
            "grade_class_manage",
            "case_manage",
            "training_access",
            "scenario_training",
            "qa_access",
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
        permissions=(
            "user_manage",
            "role_manage",
            "grade_class_manage",
            "school_manage",
            "case_manage",
            "training_access",
            "scenario_training",
            "score_review",
            "stats_view",
            "qa_access",
            "llm_monitor",
            "assignment_manage",
            "feedback_review",
            "export_data",
            "questionnaire_manage",
        ),
    ),
    "ops": PersonaDef(
        key="ops",
        label="运维视角",
        permissions=(
            "llm_monitor",
            "api_manage",
            "audit_view",
            "audit_export",
            "feedback_review",
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


def grants_all_personas(user: User) -> bool:
    """超级管理员派生拥有全部视角（不落 `user_personas` 行）。"""
    role = getattr(user, "role", None)
    return bool(role is not None and role.name == SUPER_ADMIN_ROLE)


def default_persona_for(user: User) -> str | None:
    """默认视角：系统角色按 `DEFAULT_PERSONA_BY_ROLE`；自定义角色 → None（走 legacy）。

    返回 None 表示"没有可用的视角预设"，此时生效权限回落到 `role_permissions`，
    审计里的 persona 记为 `role.name`。
    """
    role = getattr(user, "role", None)
    if role is None:
        return None
    return DEFAULT_PERSONA_BY_ROLE.get(role.name)
