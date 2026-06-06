"""merge 0006 and 0008 (questionnaire system)

Revision ID: 046e65bdb1f8
Revises: 0006, 0008
Create Date: 2026-06-06 13:08:06.276252

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '046e65bdb1f8'
down_revision: Union[str, Sequence[str], None] = ('0006', '0008')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
