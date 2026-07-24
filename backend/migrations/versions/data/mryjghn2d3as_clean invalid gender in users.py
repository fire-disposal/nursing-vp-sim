"""clean invalid gender in users

# Manual override reason: data_only

Revision ID: mryjghn2d3as
Revises: 5a57a95543dc
Create Date: 2026-07-24 06:07:45

"""

from typing import Sequence, Union

from alembic import op

revision: str = "mryjghn2d3as"
down_revision: Union[str, Sequence[str], None] = "5a57a95543dc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE users SET gender = NULL WHERE gender IS NOT NULL AND gender NOT IN ('男', '女')")


def downgrade() -> None:
    pass
