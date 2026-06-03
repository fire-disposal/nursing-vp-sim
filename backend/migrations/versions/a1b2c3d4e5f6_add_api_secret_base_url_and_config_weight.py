"""add_api_secret_base_url_and_config_weight

Revision ID: a1b2c3d4e5f6
Revises: 344efff6c8a8
Create Date: 2026-06-03
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '344efff6c8a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    ac = [c['name'] for c in insp.get_columns('api_secrets')]
    lc = [c['name'] for c in insp.get_columns('llm_configs')]

    if 'base_url' not in ac:
        op.add_column('api_secrets', sa.Column('base_url', sa.String(200), nullable=False, server_default=''))
    if 'weight' not in lc:
        op.add_column('llm_configs', sa.Column('weight', sa.Integer(), nullable=False, server_default='1'))

    op.alter_column('llm_configs', 'base_url', existing_type=sa.String(200), nullable=True)

    conn.execute(sa.text("""
        UPDATE api_secrets s
        SET base_url = (
            SELECT c.base_url FROM llm_configs c
            WHERE c.secret_id = s.id AND c.base_url IS NOT NULL AND c.base_url != ''
            LIMIT 1
        )
        WHERE s.base_url = ''
    """))


def downgrade() -> None:
    op.drop_column('api_secrets', 'base_url')
    op.drop_column('llm_configs', 'weight')
    op.alter_column('llm_configs', 'base_url', existing_type=sa.String(200), nullable=False)
