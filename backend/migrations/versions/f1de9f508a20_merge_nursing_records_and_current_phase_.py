"""merge nursing_records and current_phase heads

Revision ID: f1de9f508a20
Revises: 877be5bc4f3c, 334440c1b8eb
Create Date: 2026-06-08 00:00:21.526607

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1de9f508a20'
down_revision: Union[str, Sequence[str], None] = ('877be5bc4f3c', '334440c1b8eb')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
