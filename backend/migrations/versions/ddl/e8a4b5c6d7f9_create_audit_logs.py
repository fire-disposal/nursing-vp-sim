"""create_audit_logs

审计日志表（append-only）。设计见 `docs/review/audit-log-and-rbac-analysis-2026-09-26.md` §3.1，
落地切片见 `docs/review/refactor-plan-2026-09-26.md` §2.3（A1）。

- `actor_id` 用 ON DELETE SET NULL：删用户不得连带删掉它的审计；同时存身份快照列。
- `payload` 用 JSONB（PG）配 `server_default '{}'`，与模型声明同形。
- 索引覆盖四条查询路径：时间范围 / 某人做了什么 / 某类操作 / 某对象被谁动过（+ 拒绝与失败面板）。
- 按月归档（保留 12 个月）由 A6 的归档任务实现；本迁移先建普通表，不做分区。

Revision ID: e8a4b5c6d7f9
Revises: d9f3b4c5e6a7
Create Date: 2026-09-26

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "e8a4b5c6d7f9"
down_revision: str | Sequence[str] | None = "d9f3b4c5e6a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("actor_id", sa.Integer(), nullable=True),
        sa.Column("actor_username", sa.String(length=50), nullable=True),
        sa.Column("actor_display_name", sa.String(length=50), nullable=True),
        sa.Column("actor_role", sa.String(length=20), nullable=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("target_type", sa.String(length=32), nullable=False),
        sa.Column("target_id", sa.String(length=64), nullable=True),
        sa.Column("target_label", sa.String(length=120), nullable=True),
        sa.Column("outcome", sa.String(length=16), server_default=sa.text("'success'"), nullable=False),
        sa.Column("payload", JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("error_detail", sa.String(length=500), nullable=True),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        sa.Column("ip", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=255), nullable=True),
        sa.Column("request_method", sa.String(length=10), nullable=True),
        sa.Column("request_path", sa.String(length=200), nullable=True),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], name="fk_audit_logs_actor_id", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("outcome IN ('success', 'denied', 'failure')", name="ck_audit_logs_outcome"),
    )
    # 时间范围主扫
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"], unique=False)
    # 「某人做了什么」
    op.create_index("ix_audit_logs_actor_created", "audit_logs", ["actor_id", sa.text("created_at DESC")], unique=False)
    # 「某类操作」
    op.create_index("ix_audit_logs_action_created", "audit_logs", ["action", sa.text("created_at DESC")], unique=False)
    # 「某对象被谁动过」
    op.create_index("ix_audit_logs_target", "audit_logs", ["target_type", "target_id"], unique=False)
    # 拒绝/失败面板
    op.create_index(
        "ix_audit_logs_outcome_created",
        "audit_logs",
        ["outcome", sa.text("created_at DESC")],
        unique=False,
        postgresql_where=sa.text("outcome <> 'success'"),
    )


def downgrade() -> None:
    op.drop_index("ix_audit_logs_outcome_created", table_name="audit_logs")
    op.drop_index("ix_audit_logs_target", table_name="audit_logs")
    op.drop_index("ix_audit_logs_action_created", table_name="audit_logs")
    op.drop_index("ix_audit_logs_actor_created", table_name="audit_logs")
    op.drop_index("ix_audit_logs_created_at", table_name="audit_logs")
    op.drop_table("audit_logs")
