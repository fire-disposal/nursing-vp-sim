"""drop st_generated_assets —— 绘画 AI / 生成物链退役收尾

用户已裁定放弃「绘画者 AI」功能：`ImageProvider` / `store_generated_asset` /
管理侧三个 `/admin/generated*` 端点 / ops 指标 `generated_images_24h` 全部删除，
`st_generated_assets` 因此不再有任何写入者，本迁移把该表（含 4 个索引与去重唯一约束）
一并删除。历史建表迁移（``b7d0e2f4a6c8``）保持原样，以维持 alembic 链完整。

**保留**的图片链路是另一回事：pack 声明的资源走 ``st_assets``（上传 / 展示 / `present`），
与本表无关，不受本迁移影响。

``upgrade`` 带存在性守卫，重复执行或库中本就无表都不会报错。``downgrade`` 按退役时的
表形状（``b7d0e2f4a6c8``）重建空表，同样带守卫。

Revision ID: e3b8f1a6c2d9
Revises: c7e1a9b3d5f2
Create Date: 2026-09-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "e3b8f1a6c2d9"
down_revision: str | Sequence[str] | None = "c7e1a9b3d5f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    insp = inspect(op.get_bind())
    if "st_generated_assets" not in insp.get_table_names():
        return
    # `drop_table` 连带删掉表上的索引与约束，**不要**先逐个 `drop_index`：
    # `inspect().get_indexes()` 也会列出唯一约束背后的索引，单独 DROP 会被 PostgreSQL 拒绝
    # （`DependentObjectsStillExist: cannot drop index … because constraint … requires it`），
    # 于是整条 `alembic upgrade head` 在全新库上直接失败（CI 的 base→head 往返就是这么炸的）。
    op.drop_table("st_generated_assets")


def downgrade() -> None:
    insp = inspect(op.get_bind())
    if "st_generated_assets" in insp.get_table_names():
        return
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
