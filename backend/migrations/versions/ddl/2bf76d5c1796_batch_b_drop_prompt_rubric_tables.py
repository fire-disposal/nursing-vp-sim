"""batch_b_drop_prompt_rubric_tables

Revision ID: 2bf76d5c1796
Revises: edc17425a5f4
Create Date: 2026-06-29

"""
from collections.abc import Sequence

from alembic import op

revision: str = "2bf76d5c1796"
down_revision: str | Sequence[str] | None = "edc17425a5f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table("prompt_templates")
    op.drop_table("rubrics")


def downgrade() -> None:
    pass
