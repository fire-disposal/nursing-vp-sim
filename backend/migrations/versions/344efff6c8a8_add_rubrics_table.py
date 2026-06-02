"""add_rubrics_table

Revision ID: 344efff6c8a8
Revises: 6d128bd094e8
Create Date: 2026-06-02
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = '344efff6c8a8'
down_revision: Union[str, Sequence[str], None] = '6d128bd094e8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table("rubrics",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("version", sa.String(40), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("total_max", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("raw_max", sa.Integer(), nullable=False, server_default="57"),
        sa.Column("raw_scale", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("dimensions", JSONB(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )


def downgrade() -> None:
    op.drop_table("rubrics")
