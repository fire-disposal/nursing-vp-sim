"""Add training_session_emotion_state and training_session_emotion_event tables.

Four-dimension emotion system (v3): trust, anxiety, irritation, cooperation [0-1].
Replaces the old JSONB emotion_state blob in training_session_state.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "4d_emotion_state_and_events"
down_revision: Union[str, None] = "a307bdd54330"  # add_training_actions_table
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "training_session_emotion_state",
        sa.Column("record_id", sa.Integer(), sa.ForeignKey("training_records.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("trust", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column("anxiety", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column("irritation", sa.Float(), nullable=False, server_default="0.35"),
        sa.Column("cooperation", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("last_turn_id", sa.String(64), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "training_session_emotion_event",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("record_id", sa.Integer(), sa.ForeignKey("training_records.id", ondelete="CASCADE"), nullable=False),
        sa.Column("turn_id", sa.String(64), nullable=True),
        sa.Column("event_type", sa.String(32), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="1.0"),
        sa.Column("evidence", sa.Text(), nullable=False, server_default=""),
        sa.Column("delta", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("before_state", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("after_state", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_index("ix_emotion_event_record_id", "training_session_emotion_event", ["record_id"])
    op.create_index("ix_emotion_event_turn_id", "training_session_emotion_event", ["turn_id"])


def downgrade() -> None:
    op.drop_index("ix_emotion_event_turn_id", table_name="training_session_emotion_event")
    op.drop_index("ix_emotion_event_record_id", table_name="training_session_emotion_event")
    op.drop_table("training_session_emotion_event")
    op.drop_table("training_session_emotion_state")
