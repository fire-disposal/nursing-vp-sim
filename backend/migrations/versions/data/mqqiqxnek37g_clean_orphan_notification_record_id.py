"""clean_orphan_notification_record_id

# Manual override reason: data_only

Revision ID: mqqiqxnek37g
Revises: 1ac6b91b4c0b
Create Date: 2026-06-23 10:46:01

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'mqqiqxnek37g'
down_revision: Union[str, Sequence[str], None] = '1ac6b91b4c0b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Null out notifications.record_id values that point to non-existent training
    records, so the foreign key added in the following DDL migration can be created
    without violating referential integrity."""
    op.execute(
        """
        UPDATE notifications
        SET record_id = NULL
        WHERE record_id IS NOT NULL
          AND record_id NOT IN (SELECT id FROM training_records)
        """
    )


def downgrade() -> None:
    """Data cleanup is not reversible."""
    pass
