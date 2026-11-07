"""backfill_is_platform

# Manual override reason: data_only

把现有 `role.name = 'super_admin'` 的账号标为平台账号（`users.is_platform = true`）。
角色名与平台标记从此分工：角色名不再承担"平台"语义；本迁移是唯一一次派生。

Revision ID: b7e3f9a2c5d4
Revises: a4c2e8f1b6d3
Create Date: 2026-11-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7e3f9a2c5d4"
down_revision: str | Sequence[str] | None = "a4c2e8f1b6d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    users = sa.table("users", sa.column("id", sa.Integer()), sa.column("role_id", sa.Integer()))
    roles = sa.table("roles", sa.column("id", sa.Integer()), sa.column("name", sa.String(20)))
    platform_ids = bind.execute(
        sa.select(users.c.id).select_from(users.join(roles, roles.c.id == users.c.role_id)).where(roles.c.name == "super_admin")
    ).scalars()
    ids = list(platform_ids)
    if ids:
        bind.execute(sa.text("UPDATE users SET is_platform = true WHERE id = ANY(:ids)"), {"ids": ids})


def downgrade() -> None:
    # 标记本身可回滚；角色名仍是同一批人的证据，无需复原数据
    op.get_bind().execute(sa.text("UPDATE users SET is_platform = false"))
