"""retire wildcard llm config

# Manual override reason: data_only

Revision ID: mrhik5tc3y2q
Revises: mreipemggvlq
Create Date: 2026-07-12 08:10:31

删除通配符 purpose='*' 的 LLMConfig 行。purpose 已改为固定集合（llm_profile.PROFILES），
路由不再有 '*' 兜底分支，存量 '*' binding 变为死数据，予以清除。
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "mrhik5tc3y2q"
down_revision: str | Sequence[str] | None = "mreipemggvlq"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """删除通配符 LLMConfig。

    先把 llm_call_logs 中指向 '*' config 的外键引用置空（config_id 可空，保留历史日志行），
    再删除 config，避免 llm_call_logs_config_id_fkey 外键约束冲突。
    """
    op.execute(
        "UPDATE llm_call_logs SET config_id = NULL "
        "WHERE config_id IN (SELECT id FROM llm_configs WHERE purpose = '*')"
    )
    op.execute("DELETE FROM llm_configs WHERE purpose = '*'")


def downgrade() -> None:
    """为每个仍有配置但缺少通配符的 secret 重建一条 '*' active config（best-effort 还原）。"""
    op.execute(
        """
        INSERT INTO llm_configs (secret_id, label, purpose, status, created_at, updated_at)
        SELECT DISTINCT c.secret_id, '', '*', 'active', NOW(), NOW()
        FROM llm_configs c
        WHERE NOT EXISTS (
            SELECT 1 FROM llm_configs w
            WHERE w.secret_id = c.secret_id AND w.purpose = '*'
        )
        """
    )
