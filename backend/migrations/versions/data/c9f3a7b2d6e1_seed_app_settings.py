"""seed the app_settings singleton row

# Manual override reason: data_only

Revision ID: c9f3a7b2d6e1
Revises: b8d2e4f6a1c3
Create Date: 2026-11-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c9f3a7b2d6e1"
down_revision: str | Sequence[str] | None = "b8d2e4f6a1c3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "INSERT INTO app_settings (id, feedback_hint_enabled) "
            "VALUES (1, true) ON CONFLICT (id) DO NOTHING"
        )
    )


def downgrade() -> None:
    # 这是默认数据，不是结构；回滚后应用会自行补默认行，因此不删除用户可能已修改的设置。
    pass
