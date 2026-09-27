"""create_st_assets_table

情境训练（experimental，docs/20）的场景资源字节表：按 `(pack_key, asset_id)` 存图片等资源，
与反馈图片同构（`LargeBinary`），运行时不依赖文件系统；管理侧上传，安装时从仓库文件播种。

Revision ID: c9d0e1f2a3b4
Revises: f5e6d7c8b9a0
Create Date: 2026-09-27

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c9d0e1f2a3b4"
down_revision: str | Sequence[str] | None = "f5e6d7c8b9a0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "st_assets",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("pack_key", sa.String(length=120), nullable=False),
        sa.Column("asset_id", sa.String(length=64), nullable=False),
        sa.Column("filename", sa.String(length=200), server_default=sa.text("''"), nullable=False),
        sa.Column(
            "mime_type",
            sa.String(length=40),
            server_default=sa.text("'application/octet-stream'"),
            nullable=False,
        ),
        sa.Column("file_size", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("pack_key", "asset_id", name="uq_st_assets_pack_asset"),
    )
    op.create_index("ix_st_assets_pack", "st_assets", ["pack_key"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_st_assets_pack", table_name="st_assets")
    op.drop_table("st_assets")
