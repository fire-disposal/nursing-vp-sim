"""病例内容并入 st_packs + 会话自带内容快照（**删除修订系统**）

背景（用户裁定）：修订系统与 `state` 是自造复杂度。改成一个模型：

- `st_packs.content` = **当前内容**（保存即覆盖），`st_packs.version` = 每次保存递增的整数；
- `st_sessions.pack_content` = 开局时的**内容快照** + `pack_version`；
  判读与回放读会话自带的那份，因此**不需要**"多行不可变修订"来保证可复现性；
- 随之删除：`st_pack_revisions`（多行修订 + 形状版本）、`st_session_archives`（归档投影）、
  `st_packs.state`（experimental/reviewed —— 学生可见性只由 `published` 表达）。

数据迁移是**保内容**的：每包取最新修订写入 `st_packs.content`；每个会话按其 `pack_revision_id`
把当时那份内容抄进 `pack_content`。因为生产库实测只有 5 个包（各 1 个修订）与 9 个新机制会话，
这一步是幂等的原地搬运。

Revision ID: a4c7e2f9b1d8
Revises: e3b8f1a6c2d9
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql

revision: str = "a4c7e2f9b1d8"
down_revision: str | Sequence[str] | None = "e3b8f1a6c2d9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _columns(table: str) -> set[str]:
    insp = inspect(op.get_bind())
    if table not in insp.get_table_names():
        return set()
    return {column["name"] for column in insp.get_columns(table)}


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    """Upgrade schema."""
    tables = _tables()

    # 1) st_packs：加当前内容与整数版本；published 已由 c4a8d2f6b1e3 引入
    columns = _columns("st_packs")
    if "content" not in columns:
        op.add_column(
            "st_packs",
            sa.Column("content", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        )
    if "version" not in columns:
        op.add_column("st_packs", sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("1")))

    # 2) 内容搬迁：每包取最新修订
    if "st_pack_revisions" in tables:
        op.execute(
            """
            UPDATE st_packs AS p
               SET content = r.content,
                   version = r.revision_no
              FROM (
                    SELECT DISTINCT ON (pack_id) pack_id, content, revision_no
                      FROM st_pack_revisions
                     ORDER BY pack_id, revision_no DESC
                   ) AS r
             WHERE r.pack_id = p.id
            """
        )

    # 3) 会话：抄入当时那份内容，再丢掉对修订的引用
    session_columns = _columns("st_sessions")
    if "pack_content" not in session_columns:
        op.add_column(
            "st_sessions",
            sa.Column("pack_content", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        )
    if "pack_version" not in session_columns:
        op.add_column("st_sessions", sa.Column("pack_version", sa.Integer(), nullable=False, server_default=sa.text("0")))
    if "pack_revision_id" in session_columns and "st_pack_revisions" in tables:
        op.execute(
            """
            UPDATE st_sessions AS s
               SET pack_content = r.content,
                   pack_version = r.revision_no
              FROM st_pack_revisions AS r
             WHERE r.id = s.pack_revision_id
            """
        )
    if "pack_revision_id" in _columns("st_sessions"):
        op.drop_column("st_sessions", "pack_revision_id")

    # 4) 删掉修订系统与归档投影
    if "st_pack_revisions" in _tables():
        op.drop_index("ix_st_pack_revisions_pack", table_name="st_pack_revisions")
        op.drop_table("st_pack_revisions")
    if "st_session_archives" in _tables():
        op.drop_index("ix_st_session_archives_pack", table_name="st_session_archives")
        op.drop_table("st_session_archives")

    # 5) 展示字段并入内容，然后删掉 `title` / `one_line` 两列（**一份内容一个真源**）
    columns = _columns("st_packs")
    fills = []
    if "title" in columns:
        fills.append("CASE WHEN content ? 'title' THEN '{}'::jsonb ELSE jsonb_build_object('title', title) END")
    if "one_line" in columns:
        fills.append("CASE WHEN content ? 'one_line' THEN '{}'::jsonb ELSE jsonb_build_object('one_line', one_line) END")
    if fills:
        op.execute("UPDATE st_packs SET content = content || " + " || ".join(fills))
    for column in ("title", "one_line"):
        if column in _columns("st_packs"):
            op.drop_column("st_packs", column)

    # 6) state 没了；可见性只有 published
    if "state" in _columns("st_packs"):
        op.execute("DROP INDEX IF EXISTS ix_st_packs_state")
        op.execute("ALTER TABLE st_packs DROP CONSTRAINT IF EXISTS ck_st_packs_state")
        op.drop_column("st_packs", "state")
    if "uq_st_packs_key" not in {c["name"] for c in inspect(op.get_bind()).get_unique_constraints("st_packs")}:
        op.create_unique_constraint("uq_st_packs_key", "st_packs", ["key"])
    indexes = {ix["name"] for ix in inspect(op.get_bind()).get_indexes("st_packs")}
    if "ix_st_packs_published" not in indexes:
        op.create_index("ix_st_packs_published", "st_packs", ["published"])


def downgrade() -> None:
    """Downgrade schema：重建空修订/归档表、`state` 列与 `title` / `one_line` 列。

    `title` / `one_line` 是**从内容里取回值**的（内容不回滚，所以列值与升级前一致）；
    修订历史与归档投影已不存在，只重建空表（旧会话仍走 `pack_content` 快照）。
    """
    op.execute("DROP INDEX IF EXISTS ix_st_packs_published")
    if "title" not in _columns("st_packs"):
        op.add_column(
            "st_packs",
            sa.Column("title", sa.String(length=200), nullable=False, server_default=sa.text("''")),
        )
    if "one_line" not in _columns("st_packs"):
        op.add_column(
            "st_packs",
            sa.Column("one_line", sa.Text(), nullable=False, server_default=sa.text("''")),
        )
    # 列值从内容取回（内容本身不回滚，因此这不会丢作者写过的标题）
    op.execute(
        """
        UPDATE st_packs
           SET title = coalesce(content ->> 'title', ''),
               one_line = coalesce(content ->> 'one_line', '')
        """
    )
    if "state" not in _columns("st_packs"):
        op.add_column(
            "st_packs",
            sa.Column("state", sa.String(length=16), nullable=False, server_default=sa.text("'experimental'")),
        )
        op.create_check_constraint("ck_st_packs_state", "st_packs", "state IN ('experimental', 'reviewed')")
        op.create_index("ix_st_packs_state", "st_packs", ["state"])

    if "st_pack_revisions" not in _tables():
        op.create_table(
            "st_pack_revisions",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("pack_id", sa.Integer(), nullable=False),
            sa.Column("revision_no", sa.Integer(), nullable=False),
            sa.Column("pack_schema_version", sa.Integer(), nullable=False, server_default=sa.text("1")),
            sa.Column("content", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
            sa.Column("content_sha", sa.String(length=64), nullable=False),
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

    session_columns = _columns("st_sessions")
    if "pack_revision_id" not in session_columns:
        op.add_column(
            "st_sessions",
            sa.Column("pack_revision_id", sa.Integer(), nullable=False, server_default=sa.text("0")),
        )
