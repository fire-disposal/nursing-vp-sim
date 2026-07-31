"""add timer_started_at + timer_consumed_seconds to training_records

Timer starts on first student message, not record creation.
Auto-pause: gaps > PAUSE_THRESHOLD (5 min) between messages are capped.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b7c8d9e0f1a2"
down_revision: Union[str, None] = "4d_emotion_state_and_events"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PAUSE_THRESHOLD = 300  # 5 minutes in seconds


def upgrade() -> None:
    op.add_column(
        "training_records",
        sa.Column("timer_started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "training_records",
        sa.Column("timer_consumed_seconds", sa.Float(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("training_records", "timer_consumed_seconds")
    op.drop_column("training_records", "timer_started_at")
