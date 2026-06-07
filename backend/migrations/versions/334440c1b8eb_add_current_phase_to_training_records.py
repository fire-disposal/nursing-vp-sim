"""add current_phase to training_records

Revision ID: 334440c1b8eb
Revises: fbcb649c96d7
Create Date: 2026-06-07 23:59:44.086335
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '334440c1b8eb'
down_revision: Union[str, Sequence[str], None] = 'fbcb649c96d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    cols = [c["name"] for c in insp.get_columns("training_records")]
    if "current_phase" not in cols:
        op.add_column("training_records", sa.Column("current_phase", sa.String(length=50), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    cols = [c["name"] for c in insp.get_columns("training_records")]
    if "current_phase" in cols:
        op.drop_column("training_records", "current_phase")
