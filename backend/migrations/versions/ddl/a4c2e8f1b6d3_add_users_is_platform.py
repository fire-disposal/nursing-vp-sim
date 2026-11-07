"""add users.is_platform

把「平台账号」从角色名（`role.name == 'super_admin'`）提升为显式标记：
平台账号 = 全部院校 × 全部视角。列只由数据迁移/运维置位，API 不接受写入。

Revision ID: a4c2e8f1b6d3
Revises: f2b9d4e7c1a6
Create Date: 2026-11-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a4c2e8f1b6d3"
down_revision: str | Sequence[str] | None = "f2b9d4e7c1a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_platform", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("users", "is_platform")
