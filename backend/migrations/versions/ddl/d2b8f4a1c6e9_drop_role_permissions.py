"""drop role_permissions

权限唯一来源改为视角预设（`core/personas.py`）。`role_permissions` 中的存量语义
已由 data 迁移 `c1a9e3f7b2d6` 派生到 `user_personas`，表不再被任何代码读取。

Revision ID: d2b8f4a1c6e9
Revises: c1a9e3f7b2d6
Create Date: 2026-11-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d2b8f4a1c6e9"
down_revision: str | Sequence[str] | None = "c1a9e3f7b2d6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table("role_permissions")


def downgrade() -> None:
    op.create_table(
        "role_permissions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("role_id", sa.Integer(), sa.ForeignKey("roles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("permission", sa.String(length=40), nullable=False),
        sa.UniqueConstraint("role_id", "permission", name="ix_rp_role_perm"),
    )
