"""drop simulation_sessions —— 临床推理模拟轨退役收尾

``backend/modules/simulations/**`` 是 2026-09-28 运行期下线的已退役轨，其教学语义
已由情境训练（``modules/scenario_training/**``）取代，除自身测试外零 import。本迁移
把该轨唯一持久化的表 ``simulation_sessions``（含索引 ``ix_simulation_sessions_user``）
一并删除；历史建表/改表迁移（``9d4e2f6a8b0c`` / ``f4a5b6c7d8e9``）保持原样，以维持
alembic 链完整。

``upgrade`` 带存在性守卫（``DROP TABLE IF EXISTS`` 语义），重复执行或库中本就无表
都不会报错。``downgrade`` 按退役时的表形状（``status`` 列已在 ``f4a5b6c7d8e9`` 删除，
故这里不含该列与对应 CHECK 约束）重建空表，同样带守卫。

Revision ID: c7e1a9b3d5f2
Revises: f7d2a5c9e4b6
Create Date: 2026-09-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql

revision: str = "c7e1a9b3d5f2"
down_revision: str | Sequence[str] | None = "f7d2a5c9e4b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    insp = inspect(op.get_bind())
    if "simulation_sessions" in insp.get_table_names():
        op.drop_index("ix_simulation_sessions_user", table_name="simulation_sessions")
        op.drop_table("simulation_sessions")


def downgrade() -> None:
    insp = inspect(op.get_bind())
    if "simulation_sessions" not in insp.get_table_names():
        op.create_table(
            "simulation_sessions",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("case_version", sa.String(length=32), nullable=False),
            sa.Column("state", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_simulation_sessions_user_id"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_simulation_sessions_user", "simulation_sessions", ["user_id"], unique=False)
