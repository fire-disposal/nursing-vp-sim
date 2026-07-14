"""Scoring lifecycle helpers — shared DB-level coordination functions.

Used by both session.py (end_training) and scoring.py (background worker)
to atomically coordinate scoring state without cross-router imports.
"""

from sqlalchemy import text


def acquire_scoring(record_id: int, db, allow_retry: bool = False) -> bool:
    # ruff: noqa: S608 — parameterized via :id bound param, no user input concatenated
    result = db.execute(
        text(
            "UPDATE training_records SET scoring_status = 'pending'"
            + (" , scoring_error = NULL" if allow_retry else "")
            + " WHERE id = :id AND ("
            + (
                "scoring_status IS NULL OR scoring_status IN ('completed', 'failed')"
                if allow_retry
                else "scoring_status IS NULL"
            )
            + ")"
        ),
        {"id": record_id},
    )
    return result.rowcount > 0


def claim_scoring(record_id: int, db) -> bool:
    result = db.execute(
        text(
            "UPDATE training_records SET scoring_status = 'processing' "
            "WHERE id = :id AND (scoring_status = 'pending' OR scoring_status IS NULL)"
        ),
        {"id": record_id},
    )
    return result.rowcount > 0
