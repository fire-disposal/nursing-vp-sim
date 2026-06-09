"""add gender and avatar to users

Revision ID: a1b2c3d4e5f6
Revises: f1de9f508a20
Create Date: 2026-06-09 10:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'f1de9f508a20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    cols = [c["name"] for c in insp.get_columns("users")]
    if "gender" not in cols:
        op.add_column("users", sa.Column("gender", sa.String(length=4), nullable=True))
    if "avatar" not in cols:
        op.add_column("users", sa.Column("avatar", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "avatar")
    op.drop_column("users", "gender")
