"""add performance indexes

Revision ID: 6e47092875f4
Revises: e223ef76d97e
Create Date: 2026-05-30 12:40:05.425340

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6e47092875f4'
down_revision: Union[str, Sequence[str], None] = 'e223ef76d97e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index('ix_tr_start_time', 'training_records', ['start_time'])
    op.create_index('ix_tr_case_id', 'training_records', ['case_id'])
    op.create_index('ix_notes_record_id', 'notes', ['record_id'])


def downgrade() -> None:
    op.drop_index('ix_notes_record_id', table_name='notes')
    op.drop_index('ix_tr_case_id', table_name='training_records')
    op.drop_index('ix_tr_start_time', table_name='training_records')
