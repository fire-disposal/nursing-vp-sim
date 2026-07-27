"""backfill llm_call_logs.secret_id from llm_configs, then drop the table

# Manual override reason: data_only

ddl/e44ef60ea086 保留了 llm_configs 表用于此迁移回填。
回填完成后删除 llm_configs，完成扁平化。

Revision ID: ms39fseglx7c
Revises: e44ef60ea086
Create Date: 2026-07-27
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "ms39fseglx7c"
down_revision: Union[str, Sequence[str], None] = "e44ef60ea086"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 回填 secret_id
    op.execute("""
        UPDATE llm_call_logs
        SET secret_id = lc.secret_id
        FROM llm_configs lc
        WHERE llm_call_logs.config_id = lc.id
          AND llm_call_logs.secret_id IS NULL
    """)

    # 删除用途绑定表
    op.drop_table("llm_configs")


def downgrade() -> None:
    # 重建 llm_configs
    op.create_table(
        "llm_configs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("secret_id", sa.Integer(), sa.ForeignKey("api_secrets.id"), nullable=False),
        sa.Column("label", sa.String(80), server_default="", nullable=False),
        sa.Column("purpose", sa.String(40), nullable=False),
        sa.Column("status", sa.String(20), server_default="active", nullable=False),
        sa.Column("model_override", sa.String(80), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("secret_id", "purpose", name="uq_llmconfig_profile_purpose"),
    )
