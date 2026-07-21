"""add_feedback_images

Revision ID: 5a57a95543dc
Revises: 86eb90a41920
Create Date: 2026-07-21 22:24:47.780968

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5a57a95543dc'
down_revision: Union[str, Sequence[str], None] = '86eb90a41920'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('feedback_images',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('feedback_id', sa.Integer(), nullable=False),
    sa.Column('image_data', sa.LargeBinary(), nullable=False),
    sa.Column('mime_type', sa.String(length=20), nullable=False),
    sa.Column('file_size', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['feedback_id'], ['feedbacks.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_feedback_images_feedback_id', 'feedback_images', ['feedback_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_feedback_images_feedback_id', table_name='feedback_images')
    op.drop_table('feedback_images')
