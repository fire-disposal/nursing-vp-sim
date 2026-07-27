"""backfill llm_call_logs.secret_id from llm_configs

# Manual override reason: data_only

回填迁移前 llm_configs 表的 secret_id 到 llm_call_logs。
ddl/e44ef60ea086 已移除 llm_configs 表，此迁移独立运行。

Revision ID: ms39fseglx7c
Revises: e44ef60ea086
Create Date: 2026-07-27
"""
from typing import Sequence, Union

from alembic import op

revision: str = "ms39fseglx7c"
down_revision: Union[str, Sequence[str], None] = "e44ef60ea086"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        UPDATE llm_call_logs
        SET secret_id = lc.secret_id
        FROM llm_configs lc
        WHERE llm_call_logs.config_id = lc.id
          AND llm_call_logs.secret_id IS NULL
    """)


def downgrade() -> None:
    # 数据回填无逆向操作 — secret_id 保留不回滚
    pass
