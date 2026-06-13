"""fix_schema_drift

Revision ID: 3fb59738064c
Revises: 8b56bd1a8181
Create Date: 2026-06-13 15:01:08.472036
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '3fb59738064c'
down_revision: Union[str, Sequence[str], None] = '8b56bd1a8181'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    conn = op.get_bind()
    insp = sa.inspect(conn)

    if "user_preferences" in insp.get_table_names():
        op.drop_table('user_preferences')

    cols = {c["name"]: c for c in insp.get_columns("user_class")}
    if "class_id" in cols and not cols["class_id"]["nullable"]:
        op.alter_column('user_class', 'class_id',
                        existing_type=sa.INTEGER(),
                        nullable=True)


def downgrade() -> None:
    """Downgrade schema."""
    conn = op.get_bind()
    insp = sa.inspect(conn)

    cols = {c["name"]: c for c in insp.get_columns("user_class")}
    if "class_id" in cols and cols["class_id"]["nullable"]:
        op.alter_column('user_class', 'class_id',
                        existing_type=sa.INTEGER(),
                        nullable=False)

    if "user_preferences" not in insp.get_table_names():
        op.create_table('user_preferences',
        sa.Column('id', sa.INTEGER(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.INTEGER(), autoincrement=False, nullable=False),
        sa.Column('key', sa.VARCHAR(length=80), autoincrement=False, nullable=False),
        sa.Column('value', sa.TEXT(), autoincrement=False, nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('user_preferences_user_id_fkey'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('user_preferences_pkey')),
        sa.UniqueConstraint('user_id', 'key', name=op.f('uq_up_user_key'), postgresql_include=[], postgresql_nulls_not_distinct=False)
        )
