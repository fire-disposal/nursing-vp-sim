"""grant_audit_permissions

# Manual override reason: data_only

给存量库的 super_admin 补授权限 `audit_view` / `audit_export`
（决策 2026-09-26：审计日志仅超级管理员可见；见 core/roles.py 与
docs/review/refactor-plan-2026-09-26.md §4）。

seed 只在空库首次写权限、`roles` 表非空时不再补种，因此存量环境必须靠这条 data 迁移生效。
只插入缺失的两项（幂等），不做全量 resync —— 避免把其它角色的手工调整一起覆盖。
对空库（含 pre-push roundtrip 的临时库）为无操作。

Revision ID: f1b2c3d4e5a6
Revises: e8a4b5c6d7f9
Create Date: 2026-09-26

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f1b2c3d4e5a6"
down_revision: str | Sequence[str] | None = "e8a4b5c6d7f9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NEW_PERMISSIONS = ("audit_view", "audit_export")
_ROLE = "super_admin"


def _grant() -> None:
    bind = op.get_bind()
    for perm in _NEW_PERMISSIONS:
        # 注意：同一个命名参数不能既作 INSERT 的值又与 varchar 列比较 ——
        # PG 会为同一参数推出两种类型（text vs character varying）而报 AmbiguousParameter。
        # 故用两个参数名（内容相同）。
        bind.execute(
            sa.text(
                "INSERT INTO role_permissions (role_id, permission) "
                "SELECT r.id, :p_insert FROM roles r "
                "WHERE r.name = :n AND r.is_system = true "
                "AND NOT EXISTS ("
                "  SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission = :p_check"
                ")"
            ),
            {"n": _ROLE, "p_insert": perm, "p_check": perm},
        )


def _revoke() -> None:
    bind = op.get_bind()
    for perm in _NEW_PERMISSIONS:
        bind.execute(
            sa.text(
                "DELETE FROM role_permissions WHERE permission = :p AND role_id IN "
                "(SELECT id FROM roles WHERE name = :n AND is_system = true)"
            ),
            {"n": _ROLE, "p": perm},
        )


def upgrade() -> None:
    """Upgrade data."""
    _grant()


def downgrade() -> None:
    """Downgrade data."""
    _revoke()
