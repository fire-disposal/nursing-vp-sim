"""rename users.is_platform to users.is_superadmin

超级管理员语义回归：账号标记表达的是"拥有全部视角"，不再是旧的平台身份。
列原地改名，数据与默认值保持不变。

Revision ID: e3b7a1c9d5f2
Revises: a7d3f0b81c64
Create Date: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "e3b7a1c9d5f2"
down_revision: str | Sequence[str] | None = "a7d3f0b81c64"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema: is_platform → is_superadmin。"""
    columns = {c["name"] for c in inspect(op.get_bind()).get_columns("users")}
    if "is_platform" in columns and "is_superadmin" not in columns:
        op.alter_column(
            "users",
            "is_platform",
            new_column_name="is_superadmin",
            existing_type=sa.Boolean(),
            existing_nullable=False,
            existing_server_default=sa.text("false"),
        )


def downgrade() -> None:
    """Downgrade schema: is_superadmin → is_platform。"""
    columns = {c["name"] for c in inspect(op.get_bind()).get_columns("users")}
    if "is_superadmin" in columns and "is_platform" not in columns:
        op.alter_column(
            "users",
            "is_superadmin",
            new_column_name="is_platform",
            existing_type=sa.Boolean(),
            existing_nullable=False,
            existing_server_default=sa.text("false"),
        )
