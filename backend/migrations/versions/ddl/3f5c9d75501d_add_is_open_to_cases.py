"""add_is_open_to_cases

Revision ID: 3f5c9d75501d
Revises: e7e0f22e87e3
Create Date: 2026-07-14 10:12:07.155319

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '3f5c9d75501d'
down_revision: Union[str, Sequence[str], None] = 'e7e0f22e87e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('cases', sa.Column('is_open', sa.Boolean(), nullable=False, server_default=sa.text('false')))


def downgrade() -> None:
    op.drop_column('cases', 'is_open')
