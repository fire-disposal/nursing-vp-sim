"""add_version_to_feedback

Revision ID: 2132d65309ad
Revises: 08468dc1df6e
Create Date: auto

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '2132d65309ad'
down_revision: Union[str, Sequence[str], None] = '08468dc1df6e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('feedbacks', sa.Column('version', sa.String(20), nullable=False, server_default=sa.text("''")))


def downgrade() -> None:
    op.drop_column('feedbacks', 'version')
