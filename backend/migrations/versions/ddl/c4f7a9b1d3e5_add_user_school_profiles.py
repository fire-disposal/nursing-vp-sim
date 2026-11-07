"""add user_school_profiles and backfill home student ids

Revision ID: c4f7a9b1d3e5
Revises: b3e6c8d0f2a4
Create Date: 2026-11-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c4f7a9b1d3e5"
down_revision: str | Sequence[str] | None = "b3e6c8d0f2a4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_school_profiles",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("school_id", sa.Integer(), sa.ForeignKey("schools.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("student_id", sa.String(length=30), nullable=True),
        sa.UniqueConstraint("school_id", "student_id", name="uq_user_school_profiles_school_student"),
    )


def downgrade() -> None:
    op.drop_table("user_school_profiles")
