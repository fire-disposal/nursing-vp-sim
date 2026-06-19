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
) -> None:
    while True:
        await asyncio.sleep(interval)
        await asyncio.to_thread(_settle_with_lock, repo)


def _settle_with_lock(repo) -> None:
    db = SessionLocal()
    try:
        locked = db.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": SETTLEMENT_LOCK_KEY}).scalar()
        if not locked:
            return
        try:
            _settle_once_sync(repo, db)
        finally:
            db.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": SETTLEMENT_LOCK_KEY})
    except Exception:
        db.rollback()
        log.exception("Settlement loop error")
    finally:
        db.close()


def _settle_once_sync(repo, db) -> None:
    timeout_records = repo.find_timeout_records_sync(db)
    if not timeout_records:
        return

    log.info("Found %d timed-out sessions, marking completed", len(timeout_records))

    for record in timeout_records:
        try:
            repo.mark_completed_sync(db, record.id)

            from models import TrainingSessionState

            db.query(TrainingSessionState).filter(TrainingSessionState.record_id == record.id).delete()

            log.info("Settlement: record_id=%d completed", record.id)
        except Exception:
            log.exception("Settlement record_id=%d failed", record.id)

    db.commit()
