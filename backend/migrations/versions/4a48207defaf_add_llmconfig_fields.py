"""add_llmconfig_fields

Revision ID: 4a48207defaf
Revises: 0002
Create Date: 2026-06-04 18:49:52.282975

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4a48207defaf'
down_revision: Union[str, Sequence[str], None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    cols = [c["name"] for c in insp.get_columns(table)]
    return column in cols


def _safe_add_column(table: str, column) -> None:
    if not _has_column(table, column.name):
        op.add_column(table, column)


def _safe_alter_column(table: str, column_name: str, **kwargs) -> None:
    if _has_column(table, column_name):
        op.alter_column(table, column_name, **kwargs)


def upgrade() -> None:
    _safe_add_column('llm_configs', sa.Column('monthly_cost_limit', sa.Numeric(precision=12, scale=6), nullable=True))
    _safe_add_column('llm_configs', sa.Column('price_output_per_1m', sa.Numeric(precision=10, scale=6), nullable=True))
    _safe_add_column('llm_configs', sa.Column('price_input_per_1m', sa.Numeric(precision=10, scale=6), nullable=True))
    _safe_add_column('llm_configs', sa.Column('weight', sa.Integer(), nullable=True))
    _safe_add_column('llm_configs', sa.Column('priority', sa.Integer(), nullable=True))
    _safe_add_column('llm_configs', sa.Column('label', sa.String(length=80), nullable=True))

    op.execute("UPDATE llm_configs SET label = '', priority = 10, weight = 10, price_input_per_1m = 0, price_output_per_1m = 0 WHERE label IS NULL")

    _safe_alter_column('llm_configs', 'label', existing_type=sa.String(length=80), nullable=False)
    _safe_alter_column('llm_configs', 'priority', existing_type=sa.Integer(), nullable=False)
    _safe_alter_column('llm_configs', 'weight', existing_type=sa.Integer(), nullable=False)
    _safe_alter_column('llm_configs', 'price_input_per_1m', existing_type=sa.Numeric(precision=10, scale=6), nullable=False)
    _safe_alter_column('llm_configs', 'price_output_per_1m', existing_type=sa.Numeric(precision=10, scale=6), nullable=False)


def downgrade() -> None:
    op.drop_column('llm_configs', 'monthly_cost_limit')
    op.drop_column('llm_configs', 'price_output_per_1m')
    op.drop_column('llm_configs', 'price_input_per_1m')
    op.drop_column('llm_configs', 'weight')
    op.drop_column('llm_configs', 'priority')
    op.drop_column('llm_configs', 'label')
