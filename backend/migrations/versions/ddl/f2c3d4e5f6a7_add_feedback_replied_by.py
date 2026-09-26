"""add_feedback_replied_by

# Manual override reason: data_only

`feedbacks.replied_by`：记录回复人（决策 2026-09-26，见 docs/review/refactor-plan-2026-09-26.md §4）。
历史行的回复人无法追溯 → 保持 NULL（不猜测）。

Revision ID: f2c3d4e5f6a7
Revises: f1b2c3d4e5a6
Create Date: 2026-09-26

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f2c3d4e5f6a7"
down_revision: str | Sequence[str] | None = "f1b2c3d4e5a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("feedbacks", sa.Column("replied_by", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_feedbacks_replied_by", "feedbacks", "users", ["replied_by"], ["id"], ondelete="SET NULL"
    )


def downgrade() -> None:
    op.drop_constraint("fk_feedbacks_replied_by", "feedbacks", type_="foreignkey")
    op.drop_column("feedbacks", "replied_by")
