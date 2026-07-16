"""add_score_review_total_score

Revision ID: a4877b5b4500
Revises: mrlze6snkjy4
Create Date: 2026-07-16 23:09:59.059517

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a4877b5b4500'
down_revision: Union[str, Sequence[str], None] = 'mrlze6snkjy4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("score_reviews", sa.Column("total_score", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("score_reviews", "total_score")
