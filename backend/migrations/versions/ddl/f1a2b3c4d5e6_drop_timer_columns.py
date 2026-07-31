"""drop timer_started_at + timer_consumed_seconds from training_records

The auto-paused timer is replaced by a single wall-clock semantic:
deadline = start_time + time_limit minutes (see modules/training/timing.py).
The chat guard already enforced start_time semantics; the countdown view
and settlement loop now derive from the same source, so the two columns
carry no information the rest of the system reads.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f1a2b3c4d5e6"
down_revision: str | None = "b7c8d9e0f1a2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("training_records", "timer_consumed_seconds")
    op.drop_column("training_records", "timer_started_at")


def downgrade() -> None:
    op.add_column(
        "training_records",
        sa.Column("timer_started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "training_records",
        sa.Column("timer_consumed_seconds", sa.Float(), nullable=False, server_default="0"),
    )
