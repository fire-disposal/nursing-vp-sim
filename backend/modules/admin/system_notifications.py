"""System notification management — thin router."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from core.deps import DbSession
from core.security import require_permission
from models import User
from schemas.common import DeleteResponse
from schemas.notification import (
    SystemNotificationCreateRequest,
    SystemNotificationResponse,
    SystemNotificationUpdateRequest,
)

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

router = APIRouter(prefix="/system-notifications", tags=["admin"])

_Manager = Annotated[User, Depends(require_permission("api_manage"))]


@router.get("", response_model=list[SystemNotificationResponse])
def list_notifications(
    current_user: _Manager,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return SystemNotificationService(db).list_all(offset, limit)


@router.post("", response_model=SystemNotificationResponse)
def create_notification(
    body: SystemNotificationCreateRequest,
    current_user: _Manager,
    db: DbSession,
):
    return SystemNotificationService(db).create(body.model_dump(), current_user.id)


@router.put("/{notif_id}", response_model=SystemNotificationResponse)
def update_notification(
    notif_id: int,
    body: SystemNotificationUpdateRequest,
    current_user: _Manager,
    db: DbSession,
):
    return SystemNotificationService(db).update(notif_id, body.model_dump(exclude_unset=True))


@router.delete("/{notif_id}", response_model=DeleteResponse)
def delete_notification(
    notif_id: int,
    current_user: _Manager,
    db: DbSession,
):
    SystemNotificationService(db).delete(notif_id)
    return DeleteResponse(message="已删除")
