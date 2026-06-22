"""merge voice_configs and voice_configs_key_suffix heads

Revision ID: 7de05ac07ae8
Revises: 0e4d42bd3540, ec8f4a2b9d01
Create Date: 2026-06-22 13:51:32.812857

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7de05ac07ae8'
down_revision: Union[str, Sequence[str], None] = ('0e4d42bd3540', 'ec8f4a2b9d01')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
