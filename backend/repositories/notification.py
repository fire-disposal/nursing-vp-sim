"""System notification data access."""

from models import SystemNotification
from repositories.base import Repository


class SystemNotificationRepository(Repository[SystemNotification]):
    model = SystemNotification

    def list_paginated(self, offset: int, limit: int) -> list[SystemNotification]:
        return (
            self.db.query(SystemNotification)
            .order_by(SystemNotification.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
