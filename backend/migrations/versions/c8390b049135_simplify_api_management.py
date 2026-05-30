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
    op.add_column('api_keys', sa.Column('purpose', sa.String(length=40), nullable=True))
    op.add_column('api_keys', sa.Column('priority', sa.Integer(), nullable=True))

    op.execute("""
        UPDATE api_keys
        SET purpose = sub.purpose, priority = sub.priority
        FROM (
            SELECT DISTINCT ON (api_key_id) api_key_id, purpose, priority
            FROM api_key_rules
            ORDER BY api_key_id, priority ASC
        ) sub
        WHERE api_keys.id = sub.api_key_id
    """)

    op.alter_column('api_keys', 'purpose', nullable=False)
    op.alter_column('api_keys', 'priority', nullable=False)
    
    op.drop_table('api_key_rules')

    op.create_index('idx_api_keys_purpose', 'api_keys', ['purpose'], unique=False)


def downgrade() -> None:
    op.drop_index('idx_api_keys_purpose', table_name='api_keys')

    op.create_table('api_key_rules',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('api_key_id', sa.Integer(), nullable=False),
        sa.Column('purpose', sa.String(length=40), nullable=False),
        sa.Column('priority', sa.Integer(), nullable=False),
        sa.Column('is_enabled', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['api_key_id'], ['api_keys.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('api_key_id', 'purpose', name='uq_key_purpose')
    )

    op.drop_column('api_keys', 'priority')
    op.drop_column('api_keys', 'purpose')
