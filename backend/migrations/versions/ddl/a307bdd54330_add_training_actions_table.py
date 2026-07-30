"""add training_actions table

Revision ID: a307bdd54330
Revises: d4e5f6a7b8c9
Create Date: 2026-07-31 00:11:35.719266

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'a307bdd54330'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'training_actions',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('record_id', sa.Integer(), nullable=False),
        sa.Column('request_id', sa.String(64), nullable=False),
        sa.Column('kind', sa.String(32), nullable=False),
        sa.Column('input', postgresql.JSONB(astext_type=sa.Text()), server_default="'{}'::jsonb", nullable=False),
        sa.Column('result', postgresql.JSONB(astext_type=sa.Text()), server_default="'{}'::jsonb", nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['record_id'], ['training_records.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('record_id', 'request_id', name='uq_training_action_record_request'),
    )
    op.create_index('ix_training_actions_record_id', 'training_actions', ['record_id'])
    op.create_index('ix_training_actions_record_kind', 'training_actions', ['record_id', 'kind'])
    op.add_column('nursing_records', sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('nursing_records', 'submitted_at')
    op.drop_index('ix_training_actions_record_kind', table_name='training_actions')
    op.drop_index('ix_training_actions_record_id', table_name='training_actions')
    op.drop_table('training_actions')
