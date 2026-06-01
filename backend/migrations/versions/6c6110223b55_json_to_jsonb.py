"""json_to_jsonb

Revision ID: 6c6110223b55
Revises: 1924cc2d794e
Create Date: 2026-06-01 21:02:00.944714

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "6c6110223b55"
down_revision: Union[str, Sequence[str], None] = "1924cc2d794e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


COLUMNS = [
    ("cases", "case_data", False),
    ("scores", "detail_scores", True),
    ("scores", "strengths", True),
    ("scores", "weaknesses", True),
    ("scores", "missed_content", True),
    ("scores", "review_detail_scores", True),
    ("llm_call_logs", "meta", True),
    ("prompt_templates", "variables", True),
]


def upgrade() -> None:
    for table, column, nullable in COLUMNS:
        op.alter_column(
            table, column,
            existing_type=postgresql.JSON(astext_type=sa.Text()),
            type_=postgresql.JSONB(astext_type=sa.Text()),
            existing_nullable=nullable,
        )


def downgrade() -> None:
    for table, column, nullable in COLUMNS:
        op.alter_column(
            table, column,
            existing_type=postgresql.JSONB(astext_type=sa.Text()),
            type_=postgresql.JSON(astext_type=sa.Text()),
            existing_nullable=nullable,
        )
