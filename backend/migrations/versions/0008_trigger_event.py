"""add trigger_event to case_questionnaires

Adds trigger_event column to support configurable questionnaire popup timing.
Valid values: before_training, after_scoring, manual
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "case_questionnaires",
        sa.Column(
            "trigger_event",
            sa.String(length=30),
            nullable=False,
            server_default="before_training",
        ),
    )


def downgrade() -> None:
    op.drop_column("case_questionnaires", "trigger_event")
