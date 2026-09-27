"""System notification management — thin router."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request

from core.audit import (
    ACTION_NOTIFICATION_CREATED,
    ACTION_NOTIFICATION_DELETED,
    ACTION_NOTIFICATION_UPDATED,
    TARGET_TYPE_NOTIFICATION,
    record,
)
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

from core.exceptions import NotFoundError
from core.unit_of_work import unit_of_work
from models import SystemNotification


def _audit_value(value: Any) -> Any:
    """payload 落在 JSONB 列：日期转 ISO 字符串，其余原样。"""
    return value.isoformat() if isinstance(value, datetime) else value


class SystemNotificationService:
    def __init__(self, db: Session):
        self.db = db

    def list_all(self, offset: int, limit: int) -> list[SystemNotification]:
        return (
            self.db.query(SystemNotification)
            .order_by(SystemNotification.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )

    def create(self, data: dict, created_by: int, *, request: Request | None = None) -> SystemNotification:
        sn = SystemNotification(
            title=data["title"],
            content=data["content"],
            level=data.get("level", "info"),
            is_active=data.get("is_active", True),
            created_by=created_by,
            published_at=data.get("published_at") or datetime.now(UTC),
        )
        with unit_of_work(self.db, conflict_detail="创建通知失败"):
            self.db.add(sn)
            self.db.flush()
            # 通知面向全体用户，建/改/删都属于必审事件（2026-09-26 审计 A5）
            record(
                self.db,
                action=ACTION_NOTIFICATION_CREATED,
                target_type=TARGET_TYPE_NOTIFICATION,
                target_id=sn.id,
                target_label=sn.title,
                request=request,
                payload={
                    "level": sn.level,
                    "is_active": sn.is_active,
                    "content_length": len(sn.content),
                },
            )
        self.db.refresh(sn)
        return sn

    def update(self, notif_id: int, data: dict, *, request: Request | None = None) -> SystemNotification:
        sn = self.db.get(SystemNotification, notif_id)
        if sn is None:
            raise NotFoundError("通知不存在")
        with unit_of_work(self.db, conflict_detail="更新通知失败"):
            changes: dict[str, Any] = {}
            for field, new_value in data.items():
                old_value = getattr(sn, field)
                if old_value == new_value:
                    continue
                # 正文可能很长且含用户回填内容 → 只记长度摘要（PII 最小化）
                if field == "content":
                    changes["content"] = {
                        "before_length": len(old_value or ""),
                        "after_length": len(new_value or ""),
                    }
                else:
                    changes[field] = {"before": _audit_value(old_value), "after": _audit_value(new_value)}
                setattr(sn, field, new_value)
            self.db.flush()
            if changes:
                record(
                    self.db,
                    action=ACTION_NOTIFICATION_UPDATED,
                    target_type=TARGET_TYPE_NOTIFICATION,
                    target_id=sn.id,
                    target_label=sn.title,
                    request=request,
                    payload=changes,
                )
        self.db.refresh(sn)
        return sn

    def delete(self, notif_id: int, *, request: Request | None = None) -> None:
        sn = self.db.get(SystemNotification, notif_id)
        if sn is None:
            raise NotFoundError("通知不存在")
        title, level = sn.title, sn.level
        with unit_of_work(self.db, conflict_detail="删除通知失败"):
            record(
                self.db,
                action=ACTION_NOTIFICATION_DELETED,
                target_type=TARGET_TYPE_NOTIFICATION,
                target_id=notif_id,
                target_label=title,
                request=request,
                payload={"level": level},
            )
            self.db.delete(sn)
            self.db.flush()


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
    request: Request,
):
    return SystemNotificationService(db).create(body.model_dump(), current_user.id, request=request)


@router.put("/{notif_id}", response_model=SystemNotificationResponse)
def update_notification(
    notif_id: int,
    body: SystemNotificationUpdateRequest,
    current_user: _Manager,
    db: DbSession,
    request: Request,
):
    return SystemNotificationService(db).update(notif_id, body.model_dump(exclude_unset=True), request=request)


@router.delete("/{notif_id}", response_model=DeleteResponse)
def delete_notification(
    notif_id: int,
    current_user: _Manager,
    db: DbSession,
    request: Request,
):
    SystemNotificationService(db).delete(notif_id, request=request)
    return DeleteResponse(message="已删除")
