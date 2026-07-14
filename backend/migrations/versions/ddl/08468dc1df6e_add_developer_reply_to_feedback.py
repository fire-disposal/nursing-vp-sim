"""add_developer_reply_to_feedback

Revision ID: 08468dc1df6e
Revises: 3f5c9d75501d
Create Date: 2026-07-14 10:43:47.313361

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '08468dc1df6e'
down_revision: Union[str, Sequence[str], None] = '3f5c9d75501d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('feedbacks', sa.Column('developer_reply', sa.Text(), nullable=True))
    op.add_column('feedbacks', sa.Column('replied_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('feedbacks', 'replied_at')
    op.drop_column('feedbacks', 'developer_reply')
