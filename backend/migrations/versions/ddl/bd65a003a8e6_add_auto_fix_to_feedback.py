"""add_auto_fix_to_feedback

Revision ID: bd65a003a8e6
Revises: 2132d65309ad
Create Date: auto

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'bd65a003a8e6'
down_revision: Union[str, Sequence[str], None] = '2132d65309ad'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('feedbacks', sa.Column('auto_fix_attempted', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.add_column('feedbacks', sa.Column('auto_fix_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('feedbacks', 'auto_fix_at')
    op.drop_column('feedbacks', 'auto_fix_attempted')
