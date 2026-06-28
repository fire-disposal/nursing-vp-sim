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
from services.notification import SystemNotificationService

router = APIRouter(prefix="/system-notifications", tags=["admin"])

_Manager = Annotated[User, Depends(require_permission("api_manage"))]


@router.get("", response_model=list[SystemNotificationResponse])
def list_notifications(
    current_user: _Manager,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return SystemNotificationService(db).list(offset, limit)


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
