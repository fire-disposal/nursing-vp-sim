"""系统角色（账号类型）。

自「视角 = 权限预设」起，角色**不再承载权限**：它只是账号类型（学生/教师/管理员/平台），
用于默认视角、账号归属与展示；权限唯一来源是 `core/personas.py` 的视角预设。
"""

SYSTEM_ROLES: list[tuple[str, str]] = [
    ("super_admin", "超级管理员"),
    ("admin", "管理员"),
    ("teacher", "教师"),
    ("student", "学生"),
]
