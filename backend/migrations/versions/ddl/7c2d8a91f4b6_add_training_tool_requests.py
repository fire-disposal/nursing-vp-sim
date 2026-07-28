"""add training tool requests

Revision ID: 7c2d8a91f4b6
Revises: 137329b7b43c
Create Date: 2026-07-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "7c2d8a91f4b6"
down_revision: str | None = "137329b7b43c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "training_tool_requests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("record_id", sa.Integer(), nullable=False),
        sa.Column("request_id", sa.String(length=64), nullable=False),
        sa.Column("tool_name", sa.String(length=50), nullable=False),
        sa.Column("action", sa.String(length=50), nullable=False),
        sa.Column("response", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["record_id"],
            ["training_records.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("record_id", "request_id", name="uq_training_tool_request"),
    )
    op.create_index(
        "ix_training_tool_requests_record_id",
        "training_tool_requests",
        ["record_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_training_tool_requests_record_id", table_name="training_tool_requests")
    op.drop_table("training_tool_requests")
