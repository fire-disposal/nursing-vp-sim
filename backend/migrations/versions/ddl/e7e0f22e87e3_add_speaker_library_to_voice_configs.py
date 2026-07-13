"""add_speaker_library_to_voice_configs

Revision ID: e7e0f22e87e3
Revises: mrhik5tc3y2q
Create Date: 2026-07-14 00:34:50.598129

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'e7e0f22e87e3'
down_revision: Union[str, Sequence[str], None] = 'mrhik5tc3y2q'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('voice_configs', sa.Column('speaker_library', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('voice_configs', 'speaker_library')
