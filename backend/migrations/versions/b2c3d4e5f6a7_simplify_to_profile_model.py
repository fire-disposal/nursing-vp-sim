"""simplify_to_profile_model

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-06-03
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # ── api_secrets: add profile-level fields ──
    ac = [c['name'] for c in sa.inspect(conn).get_columns('api_secrets')]
    for col, col_type, default in [
        ('status', sa.String(20), 'active'),
        ('degraded_reason', sa.String(40), None),
        ('degraded_until', sa.DateTime(timezone=True), None),
        ('price_input_per_1m', sa.Numeric(10, 6), 0),
        ('price_output_per_1m', sa.Numeric(10, 6), 0),
        ('monthly_cost_limit', sa.Numeric(12, 6), None),
        ('call_count_today', sa.Integer(), 0),
        ('total_tokens_today', sa.BigInteger(), 0),
        ('total_cost_today', sa.Numeric(12, 6), 0),
        ('monthly_cost_used', sa.Numeric(12, 6), 0),
        ('stats_date', sa.Date(), None),
        ('stats_month', sa.String(7), None),
        ('consecutive_failures', sa.Integer(), 0),
        ('last_used_at', sa.DateTime(timezone=True), None),
    ]:
        if col not in ac:
            op.add_column('api_secrets', sa.Column(col, col_type, nullable=default is None, server_default=str(default) if default is not None else None))

    # ── api_secrets: set default values for existing rows ──
    conn.execute(sa.text("UPDATE api_secrets SET status = 'active' WHERE status IS NULL"))

    # ── llm_configs: copy pricing from llm_configs to api_secrets ──
    conn.execute(sa.text("""
        UPDATE api_secrets s
        SET price_input_per_1m = COALESCE(
            (SELECT c.price_input_per_1m FROM llm_configs c WHERE c.secret_id = s.id LIMIT 1), 0
        ),
        price_output_per_1m = COALESCE(
            (SELECT c.price_output_per_1m FROM llm_configs c WHERE c.secret_id = s.id LIMIT 1), 0
        ),
        monthly_cost_limit = (
            SELECT c.monthly_cost_limit FROM llm_configs c WHERE c.secret_id = s.id LIMIT 1
        )
    """))

    # ── llm_configs: remove old columns ──
    lc = [c['name'] for c in sa.inspect(conn).get_columns('llm_configs')]
    for col in ('label', 'base_url', 'priority', 'weight', 'price_input_per_1m',
                'price_output_per_1m', 'monthly_cost_limit', 'call_count_today',
                'total_tokens_today', 'total_cost_today', 'monthly_cost_used',
                'stats_date', 'stats_month', 'consecutive_failures', 'last_used_at',
                'degraded_reason', 'degraded_until'):
        if col in lc:
            op.drop_column('llm_configs', col)

    # ── llm_configs: change unique constraint ──
    with op.batch_alter_table('llm_configs') as batch:
        batch.drop_constraint('uq_llmconfig_purpose_priority', type_='unique')
        batch.create_unique_constraint('uq_llmconfig_profile_purpose', ['secret_id', 'purpose'])


def downgrade() -> None:
    op.add_column('llm_configs', sa.Column('label', sa.String(80), nullable=True))
    op.add_column('llm_configs', sa.Column('base_url', sa.String(200), nullable=True))
    op.add_column('llm_configs', sa.Column('priority', sa.Integer(), nullable=True))
    op.add_column('llm_configs', sa.Column('weight', sa.Integer(), nullable=True))
    op.add_column('llm_configs', sa.Column('price_input_per_1m', sa.Numeric(10, 6), nullable=True))
    op.add_column('llm_configs', sa.Column('price_output_per_1m', sa.Numeric(10, 6), nullable=True))
    op.add_column('llm_configs', sa.Column('monthly_cost_limit', sa.Numeric(12, 6), nullable=True))
    op.add_column('llm_configs', sa.Column('call_count_today', sa.Integer(), nullable=True))
    op.add_column('llm_configs', sa.Column('total_tokens_today', sa.BigInteger(), nullable=True))
    op.add_column('llm_configs', sa.Column('total_cost_today', sa.Numeric(12, 6), nullable=True))
    op.add_column('llm_configs', sa.Column('monthly_cost_used', sa.Numeric(12, 6), nullable=True))
    op.add_column('llm_configs', sa.Column('stats_date', sa.Date(), nullable=True))
    op.add_column('llm_configs', sa.Column('stats_month', sa.String(7), nullable=True))
    op.add_column('llm_configs', sa.Column('consecutive_failures', sa.Integer(), nullable=True))
    op.add_column('llm_configs', sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('llm_configs', sa.Column('degraded_reason', sa.String(40), nullable=True))
    op.add_column('llm_configs', sa.Column('degraded_until', sa.DateTime(timezone=True), nullable=True))
