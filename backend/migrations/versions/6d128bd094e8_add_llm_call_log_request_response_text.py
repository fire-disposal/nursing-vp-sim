"""add_llm_call_log_request_response_text

Revision ID: 6d128bd094e8
Revises: 5d49764786fe
Create Date: 2026-06-02
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '6d128bd094e8'
down_revision: Union[str, Sequence[str], None] = '5d49764786fe'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('llm_call_logs', sa.Column('request_text', sa.Text(), nullable=True))
    op.add_column('llm_call_logs', sa.Column('response_text', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('llm_call_logs', 'response_text')
    op.drop_column('llm_call_logs', 'request_text')