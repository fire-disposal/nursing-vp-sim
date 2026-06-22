"""add voice_configs and voice_call_logs

Revision ID: 0e4d42bd3540
Revises: mqo27fafw5eq
Create Date: 2026-06-22 13:01:23.134689

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0e4d42bd3540'
down_revision: Union[str, Sequence[str], None] = 'mqo27fafw5eq'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('voice_configs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('provider', sa.String(length=20), nullable=False),
        sa.Column('app_id', sa.String(length=80), nullable=False),
        sa.Column('token_enc', sa.Text(), nullable=False),
        sa.Column('tts_voice_type', sa.String(length=40), nullable=False),
        sa.Column('tts_timeout', sa.Integer(), nullable=False),
        sa.Column('asr_sample_rate', sa.Integer(), nullable=False),
        sa.Column('asr_enable_streaming', sa.Boolean(), nullable=False),
        sa.Column('monthly_budget', sa.Float(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_table('voice_call_logs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('record_id', sa.Integer(), nullable=True),
        sa.Column('direction', sa.String(length=10), nullable=False),
        sa.Column('text_length', sa.Integer(), nullable=False),
        sa.Column('emotion_state', sa.String(length=20), nullable=True),
        sa.Column('confidence', sa.Float(), nullable=True),
        sa.Column('latency_ms', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('cost_estimated', sa.Float(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['record_id'], ['training_records.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_vcl_user_created', 'voice_call_logs', ['user_id', 'created_at'])
    op.create_index('ix_vcl_direction', 'voice_call_logs', ['direction'])
    op.create_index('ix_vcl_created_at', 'voice_call_logs', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_vcl_created_at', table_name='voice_call_logs')
    op.drop_index('ix_vcl_direction', table_name='voice_call_logs')
    op.drop_index('ix_vcl_user_created', table_name='voice_call_logs')
    op.drop_table('voice_call_logs')
    op.drop_table('voice_configs')
