"""add system_configs table

Revision ID: a1b2c3d4e6f0
Revises: bfc464be38da
Create Date: 2026-06-18 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e6f0"
down_revision: Union[str, Sequence[str], None] = "bfc464be38da"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    if "system_configs" not in insp.get_table_names():
        op.create_table(
            "system_configs",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("key", sa.String(length=80), nullable=False),
            sa.Column("value", sa.Text(), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_system_configs_key"), "system_configs", ["key"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_system_configs_key"), table_name="system_configs")
    op.drop_table("system_configs")
