"""add runtime_state to training_records

Revision ID: a1b2c3d4e5f8
Revises: 3fb59738064c
Create Date: 2026-06-15
"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'a1b2c3d4e5f8'
down_revision: Union[str, Sequence[str], None] = '3fb59738064c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    cols = [c["name"] for c in insp.get_columns("training_records")]

    if "runtime_state" not in cols:
        op.add_column(
            "training_records",
            sa.Column("runtime_state", postgresql.JSONB, server_default=sa.text("'{}'::jsonb")),
        )

    rows = conn.execute(
        sa.text("SELECT id, practice_snapshot FROM training_records")
    ).fetchall()
    for row in rows:
        snap = dict(row.practice_snapshot or {})
        runtime = {}
        for old_key, new_key in [
            ("_exam_results", "exam_results"),
            ("_phase_op_count", "phase_op_count"),
        ]:
            if old_key in snap:
                runtime[new_key] = snap.pop(old_key)
        if "_exam_impact_note" in snap:
            runtime["exam_impact_note"] = snap.pop("_exam_impact_note")
        for key in list(snap):
            if key.startswith("_"):
                del snap[key]
        conn.execute(
            sa.text(
                "UPDATE training_records SET practice_snapshot = :snap::jsonb, runtime_state = :rt::jsonb WHERE id = :id"
            ),
            {"snap": json.dumps(snap), "rt": json.dumps(runtime), "id": row.id},
        )


def downgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    cols = [c["name"] for c in insp.get_columns("training_records")]

    if "runtime_state" in cols:
        rows = conn.execute(
            sa.text(
                "SELECT id, practice_snapshot, runtime_state FROM training_records "
                "WHERE runtime_state IS NOT NULL AND runtime_state != '{}'::jsonb"
            )
        ).fetchall()
        for row in rows:
            snap = dict(row.practice_snapshot or {})
            rt = dict(row.runtime_state or {})
            for new_key, old_key in [
                ("exam_results", "_exam_results"),
                ("phase_op_count", "_phase_op_count"),
            ]:
                if new_key in rt:
                    snap[old_key] = rt.pop(new_key)
            if "exam_impact_note" in rt:
                snap["_exam_impact_note"] = rt.pop("exam_impact_note")
            conn.execute(
                sa.text("UPDATE training_records SET practice_snapshot = :snap::jsonb WHERE id = :id"),
                {"snap": json.dumps(snap), "id": row.id},
            )

        op.drop_column("training_records", "runtime_state")
