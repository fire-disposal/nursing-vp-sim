"""删掉修订系统与归档投影 + 合并后的冗余列（结构，无数据操作）

- 删表：`st_pack_revisions`（多行不可变修订 + 形状版本）、`st_session_archives`（归档投影）；
- 删列：`st_packs.state`（学生可见性只由 `published` 表达）、`st_packs.title`/`one_line`
  （展示字段只在内容里）、`st_sessions.pack_revision_id`（改由 `pack_content` 快照）；
- 加 `ix_st_packs_published`（列表按上架过滤）。

`downgrade` 把表与列重建回来（`title`/`one_line`/`state` 的值从内容取 / 给默认值；
修订与归档的历史**不会**回来——那正是本次要删的东西）。

Revision ID: c6e9a4b3d7f1
Revises: b5d8f3a2c6e9
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql

revision: str = "c6e9a4b3d7f1"
down_revision: str | Sequence[str] | None = "b5d8f3a2c6e9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set[str]:
    insp = inspect(op.get_bind())
    if table not in insp.get_table_names():
        return set()
    return {column["name"] for column in insp.get_columns(table)}


def upgrade() -> None:
    """Upgrade schema."""
    tables = _tables()
    if "st_pack_revisions" in tables:
        op.drop_table("st_pack_revisions")  # 唯一约束背后的索引随表一起消失
    if "st_session_archives" in tables:
        op.drop_table("st_session_archives")

    if "state" in _columns("st_packs"):
        constraints = {item["name"] for item in inspect(op.get_bind()).get_check_constraints("st_packs")}
        if "ck_st_packs_state" in constraints:
            op.drop_constraint("ck_st_packs_state", "st_packs", type_="check")
        indexes = {item["name"] for item in inspect(op.get_bind()).get_indexes("st_packs")}
        if "ix_st_packs_state" in indexes:
            op.drop_index("ix_st_packs_state", table_name="st_packs")
        op.drop_column("st_packs", "state")
    for column in ("title", "one_line"):
        if column in _columns("st_packs"):
            op.drop_column("st_packs", column)

    if "pack_revision_id" in _columns("st_sessions"):
        op.drop_column("st_sessions", "pack_revision_id")

    indexes = {item["name"] for item in inspect(op.get_bind()).get_indexes("st_packs")}
    if "ix_st_packs_published" not in indexes:
        op.create_index("ix_st_packs_published", "st_packs", ["published"])


def downgrade() -> None:
    """Downgrade schema：把表与列重建回来（历史与内容不回滚）。"""
    indexes = {item["name"] for item in inspect(op.get_bind()).get_indexes("st_packs")}
    if "ix_st_packs_published" in indexes:
        op.drop_index("ix_st_packs_published", table_name="st_packs")

    if "state" not in _columns("st_packs"):
        op.add_column(
            "st_packs",
            sa.Column("state", sa.String(length=16), nullable=False, server_default=sa.text("'experimental'")),
        )
        op.create_check_constraint("ck_st_packs_state", "st_packs", "state IN ('experimental', 'reviewed')")
        op.create_index("ix_st_packs_state", "st_packs", ["state"])

    pack_columns = _columns("st_packs")
    if "title" not in pack_columns:
        op.add_column("st_packs", sa.Column("title", sa.String(length=200), nullable=False, server_default=sa.text("''")))
    if "one_line" not in pack_columns:
        op.add_column("st_packs", sa.Column("one_line", sa.Text(), nullable=False, server_default=sa.text("''")))
    # 列值由 data 迁移的 downgrade 从内容取回（数据操作不放 ddl）

    if "pack_revision_id" not in _columns("st_sessions"):
        op.add_column(
            "st_sessions",
            sa.Column("pack_revision_id", sa.Integer(), nullable=False, server_default=sa.text("0")),
        )

    if "st_pack_revisions" not in _tables():
        op.create_table(
            "st_pack_revisions",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("pack_id", sa.Integer(), nullable=False),
            sa.Column("revision_no", sa.Integer(), nullable=False),
            sa.Column("pack_schema_version", sa.Integer(), nullable=False, server_default=sa.text("1")),
            sa.Column("content", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
            sa.Column("content_sha", sa.String(length=64), nullable=False, server_default=sa.text("''")),
            sa.Column("note", sa.Text(), nullable=False, server_default=sa.text("''")),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("pack_id", "revision_no", name="uq_st_pack_revisions_pack_rev"),
        )
        op.create_index("ix_st_pack_revisions_pack", "st_pack_revisions", ["pack_id"])

    if "st_session_archives" not in _tables():
        op.create_table(
            "st_session_archives",
            sa.Column("id", sa.BigInteger(), nullable=False),
            sa.Column("session_id", sa.Integer(), nullable=False),
            sa.Column("pack_key", sa.String(length=120), nullable=False),
            sa.Column("pack_revision_id", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("shape_version", sa.Integer(), nullable=False, server_default=sa.text("1")),
            sa.Column("status", sa.String(length=16), nullable=False, server_default=sa.text("'completed'")),
            sa.Column("turn", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("ended_reason", sa.String(length=32), nullable=False, server_default=sa.text("''")),
            sa.Column("has_report", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
            sa.Column("note", sa.Text(), nullable=False, server_default=sa.text("''")),
            sa.Column("archived_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("session_id", name="uq_st_session_archives_session"),
            sa.CheckConstraint("shape_version >= 1", name="ck_st_session_archives_shape"),
        )
        op.create_index("ix_st_session_archives_pack", "st_session_archives", ["pack_key"])
