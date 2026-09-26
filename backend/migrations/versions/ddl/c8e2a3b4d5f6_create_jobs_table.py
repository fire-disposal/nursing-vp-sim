"""create_jobs_table

持久化 Job 表（docs/ideas/pipeline-and-job-separation.md）。首个消费者是评分：
``SCORING_EXECUTION=job`` 时由认领器执行 ``kind='scoring'`` 的任务，替代进程内 TaskQueue。

Revision ID: c8e2a3b4d5f6
Revises: b7d1f2a3c4e5
Create Date: 2026-09-26

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "c8e2a3b4d5f6"
down_revision: str | Sequence[str] | None = "b7d1f2a3c4e5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "jobs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("record_id", sa.Integer(), nullable=True),
        sa.Column("payload", JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("status", sa.String(length=16), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("priority", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("max_attempts", sa.Integer(), server_default=sa.text("2"), nullable=False),
        sa.Column("available_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("lease_owner", sa.String(length=120), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.ForeignKeyConstraint(["record_id"], ["training_records.id"], name="fk_jobs_record_id", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    # 认领路径：kind + status + available_at（+ priority/id 决定次序）
    op.create_index("ix_jobs_claim", "jobs", ["kind", "status", "available_at", "priority", "id"], unique=False)
    # 同一记录的评分不得同时挂起两条（部分唯一索引）
    op.create_index(
        "uq_jobs_active_scoring",
        "jobs",
        ["record_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'scoring' AND status IN ('pending', 'running')"),
    )


def downgrade() -> None:
    op.drop_index("uq_jobs_active_scoring", table_name="jobs")
    op.drop_index("ix_jobs_claim", table_name="jobs")
    op.drop_table("jobs")
