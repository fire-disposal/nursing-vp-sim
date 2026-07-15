"""System notification business logic."""

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from core.unit_of_work import unit_of_work
from models import SystemNotification
from repositories.notification import SystemNotificationRepository


class SystemNotificationService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = SystemNotificationRepository(db)

    def list_all(self, offset: int, limit: int) -> list[SystemNotification]:
        return self.repo.list_paginated(offset, limit)

    def create(self, data: dict, created_by: int) -> SystemNotification:
        sn = SystemNotification(
            title=data["title"],
            content=data["content"],
            level=data.get("level", "info"),
            is_active=data.get("is_active", True),
            created_by=created_by,
            published_at=data.get("published_at") or datetime.now(UTC),
        )
        with unit_of_work(self.db, conflict_detail="创建通知失败"):
            self.repo.add(sn)
        self.db.refresh(sn)
        return sn

    def update(self, notif_id: int, data: dict) -> SystemNotification:
        sn = self.repo.get_or_404(notif_id, "通知不存在")
        with unit_of_work(self.db, conflict_detail="更新通知失败"):
            for k, v in data.items():
                setattr(sn, k, v)
            self.db.flush()
        self.db.refresh(sn)
        return sn

    def delete(self, notif_id: int) -> None:
        sn = self.repo.get_or_404(notif_id, "通知不存在")
        with unit_of_work(self.db, conflict_detail="删除通知失败"):
            self.repo.delete(sn)
