"""batch_a_case_schema

Revision ID: edc17425a5f4
Revises: d7bf73a4fd58
Create Date: 2026-06-29

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "edc17425a5f4"
down_revision: str | Sequence[str] | None = "d7bf73a4fd58"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("cases", sa.Column("training_type", sa.String(50), server_default="history_taking", nullable=False))
    op.add_column("cases", sa.Column("difficulty", sa.Integer, server_default="1", nullable=False))
    op.add_column("cases", sa.Column("time_limit_minutes", sa.Integer, server_default="20", nullable=False))

    op.execute("UPDATE cases SET difficulty = (case_data->>'difficulty')::int WHERE case_data ? 'difficulty'")
    op.execute("UPDATE cases SET time_limit_minutes = (case_data->>'time_limit')::int WHERE case_data ? 'time_limit'")

    op.add_column("training_records", sa.Column("training_type", sa.String(50), server_default="history_taking", nullable=False))
    op.add_column("training_records", sa.Column("prompt_snapshot", JSONB, nullable=True))
    op.add_column("training_records", sa.Column("rubric_snapshot", JSONB, nullable=True))

    op.drop_constraint("ck_training_records_current_phase", "training_records", type_="check")
    op.drop_constraint("ck_messages_role", "messages", type_="check")


def downgrade() -> None:
    op.create_check_constraint("ck_messages_role", "messages", "role IN ('student', 'patient', 'system')")
    op.create_check_constraint(
        "ck_training_records_current_phase", "training_records", "current_phase IN ('history_taking', 'physical_exam', 'ending')"
    )
    op.drop_column("training_records", "rubric_snapshot")
    op.drop_column("training_records", "prompt_snapshot")
    op.drop_column("training_records", "training_type")
    op.drop_column("cases", "time_limit_minutes")
    op.drop_column("cases", "difficulty")
    op.drop_column("cases", "training_type")
