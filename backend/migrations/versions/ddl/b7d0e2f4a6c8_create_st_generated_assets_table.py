"""create_st_generated_assets_table

情境训练（experimental，docs/20）的 **DM 现场生成物**表：会话里按需生成的图片字节。

与 `st_assets` 同构（`LargeBinary` 存字节、运行时不依赖文件系统），但属于**一次会话**：
`session_id` / `pack_revision_id` 与其余 `st_*` 一样只存整数标识、不加外键（隔离红线，docs/20 §2.4）。
去重口径：同一会话内同一份字节只留一行（`uq_st_generated_assets_session_sha`）。
本次改造同时**删掉磁盘缓存**（`SCENARIO_IMAGE_CACHE_DIR`）：库里一行 = 一张图，删除即回收。

Revision ID: b7d0e2f4a6c8
Revises: c9d0e1f2a3b4
Create Date: 2026-09-27

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7d0e2f4a6c8"
down_revision: str | Sequence[str] | None = "c9d0e1f2a3b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "st_generated_assets",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("pack_key", sa.String(length=120), nullable=False),
        sa.Column("pack_revision_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), server_default=sa.text("'image'"), nullable=False),
        sa.Column("prompt", sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column(
            "mime_type",
            sa.String(length=40),
            server_default=sa.text("'application/octet-stream'"),
            nullable=False,
        ),
        sa.Column("file_size", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "sha256", name="uq_st_generated_assets_session_sha"),
    )
    op.create_index("ix_st_generated_assets_session", "st_generated_assets", ["session_id"], unique=False)
    op.create_index("ix_st_generated_assets_pack", "st_generated_assets", ["pack_key"], unique=False)
    op.create_index("ix_st_generated_assets_kind_sha", "st_generated_assets", ["kind", "sha256"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_st_generated_assets_kind_sha", table_name="st_generated_assets")
    op.drop_index("ix_st_generated_assets_pack", table_name="st_generated_assets")
    op.drop_index("ix_st_generated_assets_session", table_name="st_generated_assets")
    op.drop_table("st_generated_assets")
