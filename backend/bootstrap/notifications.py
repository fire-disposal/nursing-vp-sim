"""System notification publisher bootstrap helpers."""

import asyncio
import logging
from datetime import UTC, datetime

from sqlalchemy import insert, text

from core.database import SessionLocal
from models import Notification, SystemNotification, User

log = logging.getLogger(__name__)

NOTIFICATION_LOCK_KEY = 987654322


def publish_pending_notifications() -> None:
    """Deliver due system notifications to active users.

    Holds a PostgreSQL advisory lock so only one worker publishes at a time.
    Safe to call repeatedly; failures are logged and swallowed.
    """
    db = SessionLocal()
    try:
        locked = db.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": NOTIFICATION_LOCK_KEY}).scalar()
        if not locked:
            return
        try:
            now = datetime.now(UTC)
            pending = (
                db.query(SystemNotification)
                .filter(
                    SystemNotification.is_active == True,
                    SystemNotification.published_at.isnot(None),
                    SystemNotification.published_at <= now,
                )
                .all()
            )
            if not pending:
                return
            user_ids = [r[0] for r in db.query(User.id).filter(User.is_active == True).all()]
            if not user_ids:
                # No recipients yet — keep notifications active so they deliver once users exist.
                log.warning("Notification publisher: %d pending but no active users; deferring", len(pending))
                return
            for system_notification in pending:
                db.execute(
                    insert(Notification).values(
                        [
                            dict(
                                user_id=user_id,
                                type="system",
                                title=system_notification.title,
                                body=system_notification.content,
                            )
                            for user_id in user_ids
                        ]
                    )
                )
                system_notification.is_active = False
                log.info("Notification published: %s -> %d users", system_notification.title, len(user_ids))
            db.commit()
        finally:
            try:
                db.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": NOTIFICATION_LOCK_KEY})
            except Exception:
                log.warning("Failed to release notification advisory lock", exc_info=True)
    except Exception:
        log.exception("Notification publisher error")
        db.rollback()
    finally:
        db.close()


async def notification_publisher(interval: int = 60):
    """Periodically publish due SystemNotification rows."""
    while True:
        await asyncio.sleep(interval)
        await asyncio.to_thread(publish_pending_notifications)
