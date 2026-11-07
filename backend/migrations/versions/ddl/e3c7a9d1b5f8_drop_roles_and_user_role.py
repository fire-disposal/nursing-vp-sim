"""drop roles and users.role_id

角色彻底退场：账号身份 = 院校 + 班级 + 视角授予 + 平台标记。
`roles`/`users.role_id` 不再被任何代码读取；存量权限已由 data 迁移派生到 `user_personas`。

Revision ID: e3c7a9d1b5f8
Revises: d9f2a6c4e8b1
Create Date: 2026-11-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e3c7a9d1b5f8"
down_revision: str | Sequence[str] | None = "d9f2a6c4e8b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("users", "role_id")
    op.drop_table("roles")


def downgrade() -> None:
    op.create_table(
        "roles",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(length=20), nullable=False),
        sa.Column("display_name", sa.String(length=40), nullable=False),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    # 旧迁移按显式约束名 `uq_roles_name` 操作，回滚必须还原同名约束
    op.create_unique_constraint("uq_roles_name", "roles", ["name"])
    op.add_column("users", sa.Column("role_id", sa.Integer(), nullable=True))
    op.create_foreign_key("users_role_id_fkey", "users", "roles", ["role_id"], ["id"], ondelete="RESTRICT")
