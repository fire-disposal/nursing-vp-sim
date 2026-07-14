"""add_cascade_delete_to_message_and_score_fk

Revision ID: 9444ffc07cd6
Revises: bd65a003a8e6
Create Date: 2026-07-14 20:02:47.333359

"""
from typing import Sequence, Union

from alembic import op

revision: str = '9444ffc07cd6'
down_revision: Union[str, Sequence[str], None] = 'bd65a003a8e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint('fk_messages_record_id', 'messages', type_='foreignkey')
    op.create_foreign_key('fk_messages_record_id', 'messages', 'training_records', ['record_id'], ['id'], ondelete='CASCADE')
    op.drop_constraint('fk_scores_record_id', 'scores', type_='foreignkey')
    op.create_foreign_key('fk_scores_record_id', 'scores', 'training_records', ['record_id'], ['id'], ondelete='CASCADE')


def downgrade() -> None:
    op.drop_constraint('fk_scores_record_id', 'scores', type_='foreignkey')
    op.create_foreign_key('fk_scores_record_id', 'scores', 'training_records', ['record_id'], ['id'])
    op.drop_constraint('fk_messages_record_id', 'messages', type_='foreignkey')
    op.create_foreign_key('fk_messages_record_id', 'messages', 'training_records', ['record_id'], ['id'])
