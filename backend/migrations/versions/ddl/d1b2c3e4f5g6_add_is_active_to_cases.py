"""add_is_active_to_cases

Revision ID: d1b2c3e4f5g6
Revises: edc17425a5f4
Create Date: 2026-07-14 02:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "d1b2c3e4f5g6"
down_revision: str | Sequence[str] | None = "edc17425a5f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "cases",
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.create_index(op.f("ix_cases_is_active"), "cases", ["is_active"])


def downgrade() -> None:
    op.drop_index(op.f("ix_cases_is_active"), table_name="cases")
    op.drop_column("cases", "is_active")
