"""系统角色权限与代码对齐：新增权限 key 必须对**既有库**生效。

回归背景（2026-10-27 生产实测）：`_seed_data` 原本在「角色表非空」时直接 return，
于是 `school_manage` 只写进了空库新装的环境；线上所有角色都没有这个 key，
院校管理页对所有人 403 —— 功能上线了但没人有权限。
"""

from __future__ import annotations

from core.permissions import PERMISSION_KEYS
from core.roles import SYSTEM_PERMISSIONS
from models import Role, RolePermission
from seed import sync_system_roles


def test_sync_grants_new_permission_to_existing_role(pg_session):
    db = pg_session
    role = Role(name="super_admin", display_name="超级管理员", is_system=True)
    db.add(role)
    db.flush()
    # 模拟"旧库"：只有一部分权限，且多一条已被删除的旧 key
    for perm in PERMISSION_KEYS[:-1]:
        db.add(RolePermission(role_id=role.id, permission=perm))
    db.add(RolePermission(role_id=role.id, permission="legacy_gone_permission"))
    db.flush()

    sync_system_roles(db)

    current = {rp.permission for rp in db.query(RolePermission).filter(RolePermission.role_id == role.id).all()}
    assert current == set(SYSTEM_PERMISSIONS["super_admin"])
    assert PERMISSION_KEYS[-1] in current, "新增 key 必须补上，否则新功能对所有人 403"
    assert "legacy_gone_permission" not in current


def test_sync_is_idempotent_and_creates_all_system_roles(pg_session):
    db = pg_session
    first = sync_system_roles(db)
    second = sync_system_roles(db)

    assert first == second
    assert set(first) == set(SYSTEM_PERMISSIONS)
    for role_name, perms in SYSTEM_PERMISSIONS.items():
        got = {
            rp.permission for rp in db.query(RolePermission).filter(RolePermission.role_id == first[role_name]).all()
        }
        assert got == set(perms)
