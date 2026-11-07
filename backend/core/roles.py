"""系统角色 → 权限映射（由 `core/personas.py` 的视角预设派生）。

角色权限仍然是**代码拥有**的：`seed.sync_system_roles` 每次启动把库里的
`role_permissions` 对齐到这张表。自「视角 = 权限预设」起，四种系统角色的权限
不再是手写清单，而是视角预设的组合，杜绝两处漂移：

- `student/teacher/admin` = 同名视角的预设；
- `super_admin` = 全部权限（**派生**而不是枚举：新增 key 自动包含，
  杜绝"新功能上线后超管反而 403"）。

运行时真正生效的权限不取这里，而是 `core.security.resolve_view_persona`
按**当前视角**算出来的；本表只用于 seed、角色管理的展示与既有校验。
"""

from core.permissions import PERMISSION_KEYS
from core.personas import PERSONAS


def _system_permissions() -> dict[str, list[str]]:
    return {
        "super_admin": list(PERMISSION_KEYS),
        "admin": list(PERSONAS["admin"].permissions),
        "teacher": list(PERSONAS["teacher"].permissions),
        "student": list(PERSONAS["student"].permissions),
    }


SYSTEM_PERMISSIONS: dict[str, list[str]] = _system_permissions()

SYSTEM_ROLES: list[tuple[str, str]] = [
    ("super_admin", "超级管理员"),
    ("admin", "管理员"),
    ("teacher", "教师"),
    ("student", "学生"),
]

_unknown = {p for perms in SYSTEM_PERMISSIONS.values() for p in perms} - set(PERMISSION_KEYS)
if _unknown:
    raise ValueError(f"roles.py 使用了未在 core/permissions.py 定义的权限: {sorted(_unknown)}")
