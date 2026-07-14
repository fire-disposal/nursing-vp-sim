"""drop_grade_academic_year

Revision ID: ae7285a8c73c
Revises: 9444ffc07cd6
Create Date: 2026-07-14 21:24:14.208152

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'ae7285a8c73c'
down_revision: Union[str, Sequence[str], None] = '9444ffc07cd6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('grades', 'academic_year')


def downgrade() -> None:
    op.add_column('grades', sa.Column('academic_year', sa.VARCHAR(length=9), autoincrement=False, nullable=True))
