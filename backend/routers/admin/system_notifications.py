"""System notification management — scheduled broadcast announcements."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import require_permission
from models import SystemNotification, User
from schemas.common import DeleteResponse
from schemas.notification import (
    SystemNotificationCreateRequest,
    SystemNotificationResponse,
    SystemNotificationUpdateRequest,
)

router = APIRouter(prefix="/system-notifications", tags=["admin"])


@router.get("", response_model=list[SystemNotificationResponse])
def list_notifications(
    current_user: Annotated[User, Depends(require_permission("api_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    return db.query(SystemNotification).order_by(SystemNotification.created_at.desc()).all()


@router.post("", response_model=SystemNotificationResponse)
def create_notification(
    body: SystemNotificationCreateRequest,
    current_user: Annotated[User, Depends(require_permission("api_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    sn = SystemNotification(
        title=body.title,
        content=body.content,
        level=body.level,
        is_active=body.is_active,
        created_by=current_user.id,
        published_at=body.published_at,
    )
    db.add(sn)
    db.commit()
    db.refresh(sn)
    return sn


@router.put("/{notif_id}", response_model=SystemNotificationResponse)
def update_notification(
    notif_id: int,
    body: SystemNotificationUpdateRequest,
    current_user: Annotated[User, Depends(require_permission("api_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    sn = db.query(SystemNotification).filter(SystemNotification.id == notif_id).first()
    if not sn:
        raise HTTPException(status_code=404, detail="通知不存在")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(sn, k, v)
    db.commit()
    db.refresh(sn)
    return sn


@router.delete("/{notif_id}", response_model=DeleteResponse)
def delete_notification(
    notif_id: int,
    current_user: Annotated[User, Depends(require_permission("api_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    sn = db.query(SystemNotification).filter(SystemNotification.id == notif_id).first()
    if not sn:
        raise HTTPException(status_code=404, detail="通知不存在")
    db.delete(sn)
    db.commit()
    return DeleteResponse(message="已删除")
