"""drop_scoring_progress_table

ScoringProgressTracker moved to an in-memory dict (infra/scoring_progress.py);
the ``scoring_progress`` table is no longer written to and carries only
transient UI-facing data.  Drop the table and its ORM model.

Revision ID: b3f5a1c2d8e0
Revises: 9a8b7c6d5e4f
Create Date: 2026-07-30
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b3f5a1c2d8e0"
down_revision: str | Sequence[str] | None = "9a8b7c6d5e4f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Drop the obsolete ``scoring_progress`` table."""
    op.drop_table("scoring_progress")


def downgrade() -> None:
    """Restore the ``scoring_progress`` table (no data backfill)."""
    import sqlalchemy as sa

    op.create_table(
        "scoring_progress",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("record_id", sa.Integer(), nullable=True),
        sa.Column("stage", sa.String(length=20), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("percent", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["record_id"], ["training_records.id"], name="scoring_progress_record_id_fkey", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="scoring_progress_pkey"),
        sa.UniqueConstraint("record_id", name="uq_sp_record"),
    )
