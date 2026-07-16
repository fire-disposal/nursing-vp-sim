"""drop_current_phase

Revision ID: 17e2a568f86b
Revises: 6480fcd4c02c
Create Date: 2026-07-16 23:45:21.820865

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "17e2a568f86b"
down_revision: str | Sequence[str] | None = "6480fcd4c02c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("training_records", "current_phase")


def downgrade() -> None:
    op.add_column(
        "training_records",
        sa.Column("current_phase", sa.String(50), nullable=True),
    )
