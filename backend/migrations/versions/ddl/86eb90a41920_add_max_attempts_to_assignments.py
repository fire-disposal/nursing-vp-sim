"""add_max_attempts_to_assignments

Revision ID: 86eb90a41920
Revises: 62fb36670ee6
Create Date: 2026-07-21 19:35:13.104198

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "86eb90a41920"
down_revision: str | Sequence[str] | None = "62fb36670ee6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("assignments", sa.Column("max_attempts", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("assignments", "max_attempts")
