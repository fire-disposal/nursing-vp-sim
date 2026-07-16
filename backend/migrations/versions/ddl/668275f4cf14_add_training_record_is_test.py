"""add_training_record_is_test

Revision ID: 668275f4cf14
Revises: b15dab7b34be
Create Date: 2026-07-17 01:00:48.417232

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "668275f4cf14"
down_revision: str | Sequence[str] | None = "b15dab7b34be"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "training_records",
        sa.Column("is_test", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("training_records", "is_test")
