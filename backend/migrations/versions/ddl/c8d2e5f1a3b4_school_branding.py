"""院校品牌列：可选主题色 + 可选院徽字节。

院徽字节入库（`logo` + `logo_mime` + `logo_updated_at`），与场景图片同构：部署与环境无关，
不读文件系统。`logo_updated_at` 同时充当前端 `<img>` 的缓存版本号。

Revision ID: c8d2e5f1a3b4
Revises: b7c1d9e4a2f7
Create Date: 2026-10-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c8d2e5f1a3b4"
down_revision: Union[str, Sequence[str], None] = "b7c1d9e4a2f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("schools", sa.Column("theme_color", sa.String(length=20), nullable=True))
    op.add_column("schools", sa.Column("logo", sa.LargeBinary(), nullable=True))
    op.add_column("schools", sa.Column("logo_mime", sa.String(length=64), nullable=True))
    op.add_column("schools", sa.Column("logo_updated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("schools", "logo_updated_at")
    op.drop_column("schools", "logo_mime")
    op.drop_column("schools", "logo")
    op.drop_column("schools", "theme_color")
