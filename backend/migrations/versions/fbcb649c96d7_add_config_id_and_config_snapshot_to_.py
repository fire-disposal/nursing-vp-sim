"""add config_id and config_snapshot to training_records

Revision ID: fbcb649c96d7
Revises: 4a48207defaf
Create Date: 2026-06-06 14:06:04.504938
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'fbcb649c96d7'
down_revision: Union[str, Sequence[str], None] = '4a48207defaf'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    cols = [c["name"] for c in insp.get_columns("training_records")]
    if "config_id" not in cols:
        op.add_column("training_records", sa.Column("config_id", sa.String(length=40), nullable=True))
    if "config_snapshot" not in cols:
        op.add_column("training_records", sa.Column("config_snapshot", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    cols = [c["name"] for c in insp.get_columns("training_records")]
    if "config_snapshot" in cols:
        op.drop_column("training_records", "config_snapshot")
    if "config_id" in cols:
        op.drop_column("training_records", "config_id")
