"""Async settlement loop — auto-completes timed-out training sessions.

Uses pg_try_advisory_lock to ensure only one worker processes at a time.
"""

import asyncio
import logging

from sqlalchemy import text

from core.database import SessionLocal

log = logging.getLogger(__name__)

SETTLEMENT_LOCK_KEY = 987654321


async def settlement_loop(
    repo,
    *,
    interval: int = 30,
    enqueue_scoring=None,
) -> None:
    while True:
        await asyncio.sleep(interval)
        settled: list[tuple[int, int, dict]] = await asyncio.to_thread(_settle_with_lock, repo)
        for record_id, case_id, case_data in settled:
            if enqueue_scoring:
                enqueue_scoring(record_id, case_data)
                log.info("Settlement: enqueued scoring for record_id=%d", record_id)


def _settle_with_lock(repo) -> list[tuple[int, int, dict]]:
    db = SessionLocal()
    settled: list[tuple[int, int, dict]] = []
    try:
        locked = db.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": SETTLEMENT_LOCK_KEY}).scalar()
        if not locked:
            return settled
        try:
            settled = _settle_once_sync(repo, db)
        finally:
            db.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": SETTLEMENT_LOCK_KEY})
    except Exception:
        db.rollback()
        log.exception("Settlement loop error")
    finally:
        db.close()
    return settled


def _settle_once_sync(repo, db) -> list[tuple[int, int, dict]]:
    timeout_records = repo.find_timeout_records_sync(db)
    if not timeout_records:
        return []

    log.info("Found %d timed-out sessions, marking completed", len(timeout_records))
    settled: list[tuple[int, int, dict]] = []

    for record in timeout_records:
        try:
            repo.mark_completed_sync(db, record.id)

            from models import Case, TrainingSessionState

            db.query(TrainingSessionState).filter(TrainingSessionState.record_id == record.id).delete()

            case = db.query(Case).filter(Case.id == record.case_id).first()
            case_data = case.case_data if case else {}
            settled.append((record.id, record.case_id, case_data))

            log.info("Settlement: record_id=%d completed", record.id)
        except Exception:
            log.exception("Settlement record_id=%d failed", record.id)

    db.commit()
    return settled
