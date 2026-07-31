"""add timer_started_at to training_records

Timer now starts on first student message, not record creation.
This prevents idle time (reading case, thinking) from consuming the time limit.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b7c8d9e0f1a2"
down_revision: Union[str, None] = "4d_emotion_state_and_events"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "training_records",
        sa.Column("timer_started_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("training_records", "timer_started_at")
