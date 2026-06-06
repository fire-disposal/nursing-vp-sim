"""add nursing_records table

Revision ID: 877be5bc4f3c
Revises: fbcb649c96d7
Create Date: 2026-06-06 14:32:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '877be5bc4f3c'
down_revision: Union[str, Sequence[str], None] = 'fbcb649c96d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    if "nursing_records" not in insp.get_table_names():
        op.create_table(
            "nursing_records",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("record_id", sa.Integer(), sa.ForeignKey("training_records.id", ondelete="CASCADE"), unique=True, nullable=False),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("subjective", sa.Text(), nullable=True),
            sa.Column("objective", sa.Text(), nullable=True),
            sa.Column("assessment", sa.Text(), nullable=True),
            sa.Column("plan", sa.Text(), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )
        op.create_index("ix_nr_record_id", "nursing_records", ["record_id"])


def downgrade() -> None:
    op.drop_table("nursing_records")
