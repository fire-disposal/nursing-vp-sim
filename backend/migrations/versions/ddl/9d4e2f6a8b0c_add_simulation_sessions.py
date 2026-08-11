"""add simulation_sessions

Revision ID: 9d4e2f6a8b0c
Revises: f1a2b3c4d5e6
Create Date: 2026-08-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "9d4e2f6a8b0c"
down_revision: str | None = "f1a2b3c4d5e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "simulation_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("case_version", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("state", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('ACTIVE', 'SUCCESS', 'FAILURE')", name="ck_simulation_sessions_status"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_simulation_sessions_user_id"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_simulation_sessions_user", "simulation_sessions", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_simulation_sessions_user", table_name="simulation_sessions")
    op.drop_table("simulation_sessions")
