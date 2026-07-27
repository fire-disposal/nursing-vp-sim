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

    # 2. 解除 call_logs → llm_configs 的 FK（数据保留，llm_configs 表暂留待数据迁移处理）
    op.drop_constraint("llm_call_logs_config_id_fkey", "llm_call_logs", type_="foreignkey")

    # 3. 添加 llm_call_logs.secret_id
    op.add_column("llm_call_logs", sa.Column("secret_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_llm_call_logs_secret_id",
        "llm_call_logs", "api_secrets",
        ["secret_id"], ["id"],
        ondelete="SET NULL",
    )



def downgrade() -> None:
    # llm_configs 表由 data/ms39fseglx7c 的 downgrade 负责重建
    # 此处仅恢复 FK 和列
    op.drop_constraint("fk_llm_call_logs_secret_id", "llm_call_logs", type_="foreignkey")
    op.drop_column("llm_call_logs", "secret_id")
    op.create_foreign_key(
        "llm_call_logs_config_id_fkey",
        "llm_call_logs", "llm_configs",
        ["config_id"], ["id"],
        ondelete="SET NULL",
    )
    op.drop_column("api_secrets", "model_override")
    op.drop_column("api_secrets", "priority")

