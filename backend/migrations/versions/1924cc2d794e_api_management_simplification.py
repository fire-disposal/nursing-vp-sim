"""api_management_simplification

Revision ID: 1924cc2d794e
Revises: 7e4d9538330c
Create Date: 2026-06-01 13:06:37.097467

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1924cc2d794e'
down_revision: Union[str, Sequence[str], None] = '7e4d9538330c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table("api_secrets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(80), nullable=False),
        sa.Column("encrypted_key", sa.Text(), nullable=False),
        sa.Column("key_suffix", sa.String(8), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table("llm_configs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("secret_id", sa.Integer(), sa.ForeignKey("api_secrets.id"), nullable=False),
        sa.Column("label", sa.String(80), nullable=False),
        sa.Column("base_url", sa.String(200), nullable=False),
        sa.Column("model", sa.String(80), nullable=False),
        sa.Column("purpose", sa.String(40), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("degraded_reason", sa.String(40), nullable=True),
        sa.Column("degraded_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("price_input_per_1m", sa.Numeric(10, 6), nullable=False, server_default="0"),
        sa.Column("price_output_per_1m", sa.Numeric(10, 6), nullable=False, server_default="0"),
        sa.Column("monthly_cost_limit", sa.Numeric(12, 6), nullable=True),
        sa.Column("call_count_today", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_tokens_today", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("total_cost_today", sa.Numeric(12, 6), nullable=False, server_default="0"),
        sa.Column("monthly_cost_used", sa.Numeric(12, 6), nullable=False, server_default="0"),
        sa.Column("stats_date", sa.Date(), nullable=True),
        sa.Column("stats_month", sa.String(7), nullable=True),
        sa.Column("consecutive_failures", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_unique_constraint("uq_llmconfig_purpose_priority", "llm_configs", ["purpose", "priority"])
    op.create_index("ix_llmconfig_purpose_priority", "llm_configs", ["purpose", "priority"])

    conn = op.get_bind()

    conn.execute(sa.text("""
        INSERT INTO api_secrets (label, encrypted_key, key_suffix, created_at, updated_at)
        SELECT DISTINCT
            p.display_name || ' - Account',
            k.encrypted_key,
            k.key_suffix,
            k.created_at,
            k.updated_at
        FROM api_keys k
        JOIN api_providers p ON k.provider_id = p.id
    """))

    conn.execute(sa.text("""
        INSERT INTO llm_configs (
            secret_id, label, base_url, model, purpose, priority, status,
            price_input_per_1m, price_output_per_1m, monthly_cost_limit,
            call_count_today, total_tokens_today, total_cost_today,
            monthly_cost_used, stats_date, stats_month,
            consecutive_failures, last_used_at, created_at, updated_at
        )
        SELECT
            s.id,
            COALESCE(k.label, p.display_name || '-' || k.key_suffix),
            p.base_url,
            COALESCE(k.model, p.default_model),
            COALESCE(k.purpose, '*'),
            COALESCE(k.priority, 100),
            k.status,
            COALESCE(k.price_input_per_1m, 0), COALESCE(k.price_output_per_1m, 0), k.monthly_cost_limit,
            COALESCE(k.call_count_today, 0), COALESCE(k.total_tokens_today, 0), COALESCE(k.total_cost_today, 0),
            COALESCE(k.monthly_cost_used, 0), k.stats_date, k.stats_month,
            k.consecutive_failures, k.last_used_at, k.created_at, k.updated_at
        FROM api_keys k
        JOIN api_providers p ON k.provider_id = p.id
        JOIN api_secrets s ON s.encrypted_key = k.encrypted_key AND s.key_suffix = k.key_suffix
    """))


def downgrade() -> None:
    op.drop_table("llm_configs")
    op.drop_table("api_secrets")
