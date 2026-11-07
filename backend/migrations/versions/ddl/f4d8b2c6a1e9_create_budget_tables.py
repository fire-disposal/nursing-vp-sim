"""create school_budgets and user_budgets

Revision ID: f4d8b2c6a1e9
Revises: e3c7a9d1b5f8
Create Date: 2026-11-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f4d8b2c6a1e9"
down_revision: str | Sequence[str] | None = "e3c7a9d1b5f8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "school_budgets",
        sa.Column("school_id", sa.Integer(), sa.ForeignKey("schools.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("llm_monthly_limit", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("tts_monthly_limit", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("default_daily_llm_limit", sa.Float(), nullable=True),
        sa.Column("default_daily_tts_limit", sa.Float(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_table(
        "user_budgets",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("daily_llm_limit", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("daily_tts_limit", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("user_budgets")
    op.drop_table("school_budgets")
