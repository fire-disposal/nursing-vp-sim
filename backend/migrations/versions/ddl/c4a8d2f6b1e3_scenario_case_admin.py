"""情境病例：系统侧管理所需的列（上架状态 + 修订保存人）。

三件事，都是**只增列**（不改既有列、不动数据）：

1. `st_packs.published` / `published_at`：学生列表只列已上架的病例；下架不删数据。
   新病例默认 `false`（草稿），由作者显式上架。
2. `st_pack_revisions.created_by`：保存人（`users.id`），供「历史版本」显示"谁保存的"。
   播种 / CLI 写入的修订保持 NULL。**不加外键**（本轨与老表数据不耦合）。

既有行的 `published` 回填在 `migrations/versions/data/` 的配套迁移里（DDL 目录不放数据操作）。

Revision ID: c4a8d2f6b1e3
Revises: b3f7a1c9d2e4
Create Date: 2026-09-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c4a8d2f6b1e3"
down_revision: str | Sequence[str] | None = "b3f7a1c9d2e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("st_packs", sa.Column("published", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("st_packs", sa.Column("published_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("st_pack_revisions", sa.Column("created_by", sa.Integer(), nullable=True))


def downgrade() -> None:
    """Downgrade schema：只回退这三列（内容与状态数据不动）。"""
    op.drop_column("st_pack_revisions", "created_by")
    op.drop_column("st_packs", "published_at")
    op.drop_column("st_packs", "published")
