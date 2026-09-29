"""把既有病例回填成「已上架」，保持当前学生可见性不变。

# Manual override reason: data_only

`ddl/c4a8d2f6b1e3` 给 `st_packs` 加了 `published`（默认 false = 草稿）。
只加列不回填的话，升级完成的一瞬间**学生列表会空掉**（所有既有病例都变成未上架）——
那是数据事故，不是产品决定。所以这里把升级前就已存在的病例置为已上架，
`published_at` 用它们自己的 `updated_at`（没有更准确的时间来源，不编造 NOW()）。

新病例（此后经由系统侧新建）默认仍是草稿，必须显式上架。

Revision ID: d5b9e3a7c2f4
Revises: c4a8d2f6b1e3
Create Date: 2026-09-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d5b9e3a7c2f4"
down_revision: str | Sequence[str] | None = "c4a8d2f6b1e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade data: 既有病例 → 已上架（可见性不变）。"""
    op.execute(
        sa.text(
            """
            UPDATE st_packs
               SET published = true,
                   published_at = COALESCE(published_at, updated_at)
             WHERE published = false
            """
        )
    )


def downgrade() -> None:
    """Downgrade data: 不给反向猜测（回到"全部草稿"会再次让列表空掉）。

    真要回退，`ddl/c4a8d2f6b1e3` 的 downgrade 会把列删掉，状态自然消失。
    """
