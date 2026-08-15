"""add_training_revision_drop_tool_requests

Phase 2.5 工具指令面：
- training_records.revision：乐观并发版本号（工具/变更操作原子自增，旧版本请求 409）
- 删除 training_tool_requests：幂等与时间线合并到 training_actions
  （该表已有 unique(record_id, request_id)，同时承担 RPC 去重与域时间线）

Revision ID: d4f6a8b0c2e4f6a8
Revises: c3a9f0d1e2b4a5c6
Create Date: 2026-08-15

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlalchemy.dialects.postgresql
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4f6a8b0c2e4f6a8"
down_revision: str | Sequence[str] | None = "c3a9f0d1e2b4a5c6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "training_records",
        sa.Column("revision", sa.Integer(), server_default="0", nullable=False),
    )
    op.drop_table("training_tool_requests")


def downgrade() -> None:
    # 与原表完全对称（含索引），保证 alembic roundtrip 可回放
    op.create_table(
        "training_tool_requests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("record_id", sa.Integer(), nullable=False),
        sa.Column("request_id", sa.String(length=64), nullable=False),
        sa.Column("tool_name", sa.String(length=50), nullable=False),
        sa.Column("action", sa.String(length=50), nullable=False),
        sa.Column("response", sa.dialects.postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["record_id"], ["training_records.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("record_id", "request_id", name="uq_training_tool_request"),
    )
    op.create_index(
        "ix_training_tool_requests_record_id",
        "training_tool_requests",
        ["record_id"],
        unique=False,
    )
    op.drop_column("training_records", "revision")
