"""cleanup deprecated ApiKey model and LLMCallLog.api_key_id FK

- Drop FK constraint llm_call_logs_api_key_id_fkey (api_keys now removed from models)
- Drop index ix_llm_call_logs_api_key_id (col is always NULL, index is wasteful)
- Drop api_keys table (replaced by ApiSecret + LLMConfig)
- Drop idx_api_keys_purpose index

All operations are IF EXISTS — safe to run on fresh DBs without these objects.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE llm_call_logs DROP CONSTRAINT IF EXISTS llm_call_logs_api_key_id_fkey")
    op.execute("DROP INDEX IF EXISTS ix_llm_call_logs_api_key_id")
    op.execute("DROP TABLE IF EXISTS api_keys CASCADE")


def downgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS api_keys (
            id SERIAL PRIMARY KEY,
            provider_id INTEGER REFERENCES api_providers(id),
            label VARCHAR(80) NOT NULL,
            encrypted_key TEXT NOT NULL,
            key_suffix VARCHAR(8) NOT NULL,
            model VARCHAR(80),
            weight INTEGER DEFAULT 10,
            status VARCHAR(20) DEFAULT 'active',
            price_input_per_1m NUMERIC(10,6) DEFAULT 0,
            price_output_per_1m NUMERIC(10,6) DEFAULT 0,
            currency VARCHAR(10) DEFAULT 'CNY',
            balance NUMERIC(12,6),
            monthly_cost_limit NUMERIC(12,6),
            call_count_today INTEGER DEFAULT 0,
            total_tokens_today BIGINT DEFAULT 0,
            total_cost_today NUMERIC(12,6) DEFAULT 0,
            stats_date TIMESTAMPTZ,
            monthly_cost_used NUMERIC(12,6) DEFAULT 0,
            stats_month VARCHAR(7),
            consecutive_failures INTEGER DEFAULT 0,
            last_used_at TIMESTAMPTZ,
            rate_limit_until TIMESTAMPTZ,
            purpose VARCHAR(40) DEFAULT '*',
            priority INTEGER DEFAULT 100,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        )
    """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_api_keys_purpose ON api_keys(purpose)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_llm_call_logs_api_key_id ON llm_call_logs(api_key_id)")
    op.execute(
        "ALTER TABLE llm_call_logs ADD CONSTRAINT llm_call_logs_api_key_id_fkey "
        "FOREIGN KEY (api_key_id) REFERENCES api_keys(id)"
    )
