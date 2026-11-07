"""add user_school_personas

Revision ID: a1c7e4f9b2d6
Revises: f4d8b2c6a1e9
Create Date: 2026-11-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a1c7e4f9b2d6"
down_revision: str | Sequence[str] | None = "f4d8b2c6a1e9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_school_personas",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("school_id", sa.Integer(), sa.ForeignKey("schools.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("persona", sa.String(length=20), primary_key=True),
    )
    op.create_index("ix_user_school_personas_persona", "user_school_personas", ["persona"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_user_school_personas_persona", table_name="user_school_personas")
    op.drop_table("user_school_personas")
