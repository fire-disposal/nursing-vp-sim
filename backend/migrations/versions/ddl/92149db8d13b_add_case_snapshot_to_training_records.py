"""add_case_snapshot_to_training_records

Revision ID: 92149db8d13b
Revises: a35d80cbe22c
Create Date: 2026-07-17 00:16:56.893510

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "92149db8d13b"
down_revision: str | Sequence[str] | None = "a35d80cbe22c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("training_records", sa.Column("case_snapshot", JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("training_records", "case_snapshot")
