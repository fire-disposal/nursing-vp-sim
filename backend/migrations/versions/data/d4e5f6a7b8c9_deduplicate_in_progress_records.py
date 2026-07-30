"""deduplicate_in_progress_records

Deploy safety: the single-in_progress constraint is new.  Before it takes
effect, ensure each user has ≤1 in_progress record.  Keep the one with the
latest ``start_time``; mark all older ones ``abandoned``.

Manual override reason: data_only — DML that must run exactly once.
"""

from datetime import UTC, datetime

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision: str = "d4e5f6a7b8c9"
down_revision: str | None = "c4d5e6f7a8b9"
branch_labels: str | None = None
depends_on: str | None = None

def upgrade() -> None:
    conn = op.get_bind()
    now = datetime.now(UTC)

    # Find users with >1 in_progress record
    dupes = conn.execute(
        sa.text(
            """
            SELECT user_id
            FROM training_records
            WHERE status = 'in_progress'
            GROUP BY user_id
            HAVING count(*) > 1
            """
        )
    ).fetchall()

    for (user_id,) in dupes:
        # Keep the latest, abandon the rest
        conn.execute(
            sa.text(
                """
                WITH latest AS (
                    SELECT id FROM training_records
                    WHERE user_id = :uid AND status = 'in_progress'
                    ORDER BY start_time DESC LIMIT 1
                )
                UPDATE training_records
                SET status = 'abandoned',
                    end_time = :now,
                    scoring_status = NULL,
                    scoring_error = NULL
                WHERE user_id = :uid
                  AND status = 'in_progress'
                  AND id NOT IN (SELECT id FROM latest)
                """
            ),
            {"uid": user_id, "now": now},
        )

        # Clean up TrainingSessionState for abandoned records
        conn.execute(
            sa.text(
                """
                DELETE FROM training_session_state
                WHERE record_id IN (
                    SELECT id FROM training_records
                    WHERE user_id = :uid AND status = 'abandoned'
                )
                """
            ),
            {"uid": user_id},
        )

    total = conn.execute(
        sa.text("SELECT count(*) FROM training_records WHERE status = 'in_progress'")
    ).scalar()
    print(f"  Dedup complete: {total} in_progress records remaining")


def downgrade() -> None:
    # One-way cleanup — cannot restore which records were abandoned.
    pass
