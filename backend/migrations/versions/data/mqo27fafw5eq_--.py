"""populate created_at for system_configs and training_session_state

# Manual override reason: data_only

Revision ID: mqo27fafw5eq
Revises: ea1e2eacaf13
Create Date: 2026-06-21 17:27:24

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "mqo27fafw5eq"
down_revision: Union[str, Sequence[str], None] = "ea1e2eacaf13"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("UPDATE system_configs SET created_at = NOW() WHERE created_at IS NULL")
    op.execute("UPDATE training_session_state SET created_at = NOW() WHERE created_at IS NULL")
    op.alter_column("system_configs", "created_at", nullable=False)
    op.alter_column("training_session_state", "created_at", nullable=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column("training_session_state", "created_at", nullable=True)
    op.alter_column("system_configs", "created_at", nullable=True)
