"""add_discarded_training_status

Revision ID: 7c8f1d2a9b30
Revises: 137329b7b43c
Create Date: 2026-07-28
"""

from collections.abc import Sequence

from alembic import op

revision: str = "7c8f1d2a9b30"
down_revision: str | Sequence[str] | None = "137329b7b43c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_training_records_status", "training_records", type_="check")
    op.create_check_constraint(
        "ck_training_records_status",
        "training_records",
        "status IN ('in_progress', 'completed', 'abandoned', 'discarded')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_training_records_status", "training_records", type_="check")
    op.create_check_constraint(
        "ck_training_records_status",
        "training_records",
        "status IN ('in_progress', 'completed', 'abandoned')",
    )
