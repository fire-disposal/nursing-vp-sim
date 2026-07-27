"""flatten_api_secrets_remove_llm_configs

移除用途-密钥绑定层：llm_configs 表并入 api_secrets，
ProfileRouter 直接按 priority 选择活跃密钥。

Revision ID: e44ef60ea086
Revises: 0a3b2c1d4e5f
Create Date: 2026-07-27 20:47:33.634163
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "e44ef60ea086"
down_revision: Union[str, Sequence[str], None] = "0a3b2c1d4e5f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. 往 api_secrets 添加 priority + model_override
    op.add_column("api_secrets", sa.Column("priority", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("api_secrets", sa.Column("model_override", sa.String(80), nullable=True))

    # 2. 解除 call_logs → llm_configs 的 FK，数据保留
    op.drop_constraint("llm_call_logs_config_id_fkey", "llm_call_logs", type_="foreignkey")

    # 3. 添加 llm_call_logs.secret_id（指向 api_secrets，方便日后直接查询）
    op.add_column("llm_call_logs", sa.Column("secret_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_llm_call_logs_secret_id",
        "llm_call_logs", "api_secrets",
        ["secret_id"], ["id"],
        ondelete="SET NULL",
    )

    # 4. 回填 secret_id（从 llm_configs 关联）
    op.execute("""
        UPDATE llm_call_logs
        SET secret_id = lc.secret_id
        FROM llm_configs lc
        WHERE llm_call_logs.config_id = lc.id
          AND llm_call_logs.secret_id IS NULL
    """)

    # 5. 删除用途绑定表
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

    # 恢复 FK
    op.drop_constraint("fk_llm_call_logs_secret_id", "llm_call_logs", type_="foreignkey")
    op.drop_column("llm_call_logs", "secret_id")
    op.create_foreign_key(
        "llm_call_logs_config_id_fkey",
        "llm_call_logs", "llm_configs",
        ["config_id"], ["id"],
        ondelete="SET NULL",
    )

    # 移除新增字段
    op.drop_column("api_secrets", "model_override")
    op.drop_column("api_secrets", "priority")
