"""create_st_scenario_tables

情境训练（experimental，docs/20）的 `st_*` 表：pack 容器、不可变修订、会话、只追加事件。

隔离硬红线：本轨只读写 `st_*`，**不建指向老表的 FK**（`user_id` / `pack_revision_id` 只存
整数标识），不做跨表 JOIN、不写老表——老表结构变动不会波及本轨。

Revision ID: f5e6d7c8b9a0
Revises: e4f5a6b7c8d9
Create Date: 2026-09-27

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "f5e6d7c8b9a0"
down_revision: str | Sequence[str] | None = "e4f5a6b7c8d9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "st_packs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("key", sa.String(length=120), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("state", sa.String(length=16), server_default=sa.text("'experimental'"), nullable=False),
        sa.Column("one_line", sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("state IN ('experimental', 'reviewed')", name="ck_st_packs_state"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key", name="uq_st_packs_key"),
    )
    op.create_index("ix_st_packs_state", "st_packs", ["state"], unique=False)

    op.create_table(
        "st_pack_revisions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("pack_id", sa.Integer(), nullable=False),
        sa.Column("revision_no", sa.Integer(), nullable=False),
        sa.Column("pack_schema_version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("content", JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("content_sha", sa.String(length=64), nullable=False),
        sa.Column("note", sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("pack_id", "revision_no", name="uq_st_pack_revisions_pack_rev"),
    )
    op.create_index("ix_st_pack_revisions_pack", "st_pack_revisions", ["pack_id"], unique=False)

    op.create_table(
        "st_sessions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("pack_revision_id", sa.Integer(), nullable=False),
        sa.Column("pack_key", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=16), server_default=sa.text("'active'"), nullable=False),
        sa.Column("report", JSONB(), nullable=True),
        sa.Column("meta", JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('active', 'completed', 'abandoned')", name="ck_st_sessions_status"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_st_sessions_user", "st_sessions", ["user_id"], unique=False)
    op.create_index("ix_st_sessions_status", "st_sessions", ["status"], unique=False)

    op.create_table(
        "st_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("payload", JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.CheckConstraint(
            "kind IN ("
            "'session_opened', 'student_action', 'dm_turn', 'effects_applied', "
            "'cues_revealed', 'entity_line', 'judge_result', 'session_closed'"
            ")",
            name="ck_st_events_kind",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "seq", name="uq_st_events_session_seq"),
    )
    op.create_index("ix_st_events_session_kind", "st_events", ["session_id", "kind"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_st_events_session_kind", table_name="st_events")
    op.drop_table("st_events")
    op.drop_index("ix_st_sessions_status", table_name="st_sessions")
    op.drop_index("ix_st_sessions_user", table_name="st_sessions")
    op.drop_table("st_sessions")
    op.drop_index("ix_st_pack_revisions_pack", table_name="st_pack_revisions")
    op.drop_table("st_pack_revisions")
    op.drop_index("ix_st_packs_state", table_name="st_packs")
    op.drop_table("st_packs")
