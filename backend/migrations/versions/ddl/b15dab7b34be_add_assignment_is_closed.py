"""add_assignment_is_closed

Revision ID: b15dab7b34be
Revises: 92149db8d13b
Create Date: 2026-07-17 00:36:25.671853

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b15dab7b34be"
down_revision: str | Sequence[str] | None = "92149db8d13b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("assignments", sa.Column("is_closed", sa.Boolean(), server_default=sa.text("false"), nullable=False))


def downgrade() -> None:
    op.drop_column("assignments", "is_closed")
