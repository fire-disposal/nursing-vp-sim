"""simplify_api_management

Revision ID: c8390b049135
Revises: 5c12378db675
Create Date: 2026-05-31 00:36:42.944688

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c8390b049135'
down_revision: Union[str, Sequence[str], None] = '5c12378db675'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # 安全添加列（避免 create_all 已创建时冲突）
    cols = [r[0] for r in conn.execute(sa.text(
        "SELECT column_name FROM information_schema.columns WHERE table_name='api_keys'"
    )).fetchall()]
    if 'purpose' not in cols:
        op.add_column('api_keys', sa.Column('purpose', sa.String(length=40), nullable=True))
    if 'priority' not in cols:
        op.add_column('api_keys', sa.Column('priority', sa.Integer(), nullable=True))

    # 从 api_key_rules 迁移数据（仅当表存在时）
    tables = [r[0] for r in conn.execute(sa.text(
        "SELECT table_name FROM information_schema.tables WHERE table_name='api_key_rules' AND table_schema=current_schema()"
    )).fetchall()]
    if tables:
        conn.execute(sa.text("""
            UPDATE api_keys
            SET purpose = sub.purpose, priority = sub.priority
            FROM (
                SELECT DISTINCT ON (api_key_id) api_key_id, purpose, priority
                FROM api_key_rules
                ORDER BY api_key_id, priority ASC
            ) sub
            WHERE api_keys.id = sub.api_key_id
        """))
        conn.execute(sa.text("DROP TABLE IF EXISTS api_key_rules"))
        conn.commit()

    # 填充默认值
    conn.execute(sa.text("UPDATE api_keys SET purpose = '*', priority = 100 WHERE purpose IS NULL OR priority IS NULL"))

    # 设为 NOT NULL
    op.alter_column('api_keys', 'purpose', nullable=False)
    op.alter_column('api_keys', 'priority', nullable=False)

    # 创建索引（仅在不存在时）
    from sqlalchemy import inspect
    inspector = inspect(conn)
    indexes = [i['name'] for i in inspector.get_indexes('api_keys')]
    if 'idx_api_keys_purpose' not in indexes:
        op.create_index('idx_api_keys_purpose', 'api_keys', ['purpose'], unique=False)


def downgrade() -> None:
    op.drop_index('idx_api_keys_purpose', table_name='api_keys')

    op.drop_column('api_keys', 'priority')
    op.drop_column('api_keys', 'purpose')
