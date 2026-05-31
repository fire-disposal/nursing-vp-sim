"""add_prompt_templates

Revision ID: b390fe86e625
Revises: c8390b049135
Create Date: 2026-05-31 00:55:08.486419

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b390fe86e625'
down_revision: Union[str, Sequence[str], None] = 'c8390b049135'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    tables = [r[0] for r in conn.execute(sa.text(
        "SELECT table_name FROM information_schema.tables WHERE table_name='prompt_templates' AND table_schema=current_schema()"
    )).fetchall()]

    if not tables:
        op.create_table('prompt_templates',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('purpose', sa.String(length=40), nullable=False),
            sa.Column('version', sa.Integer(), nullable=False),
            sa.Column('name', sa.String(length=80), nullable=True),
            sa.Column('system_prompt', sa.Text(), nullable=False),
            sa.Column('user_prompt', sa.Text(), nullable=True),
            sa.Column('template_engine', sa.String(length=20), nullable=False),
            sa.Column('variables', sa.JSON(), nullable=True),
            sa.Column('is_active', sa.Boolean(), nullable=False),
            sa.Column('created_by', sa.String(length=80), nullable=True),
            sa.Column('remark', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint('id')
        )

    from sqlalchemy import inspect
    inspector = inspect(conn)
    existing_indexes = [i['name'] for i in inspector.get_indexes('prompt_templates')]
    for idx_name in ['ix_prompt_templates_purpose', 'idx_pt_purpose', 'idx_pt_purpose_active']:
        if idx_name not in existing_indexes:
            columns = ['purpose', 'is_active'] if 'active' in idx_name else ['purpose']
            op.create_index(idx_name, 'prompt_templates', columns, unique=False)


def downgrade() -> None:
    op.drop_index("idx_pt_purpose_active", table_name="prompt_templates")
    op.drop_index("idx_pt_purpose", table_name="prompt_templates")
    op.drop_index(op.f('ix_prompt_templates_purpose'), table_name='prompt_templates')
    op.drop_table('prompt_templates')
