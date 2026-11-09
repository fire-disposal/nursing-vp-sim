"""全站运行时开关：管理员写入，所有已登录用户读取公开子集。"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request

from core.audit import ACTION_SETTINGS_UPDATED, TARGET_TYPE_SETTINGS, record
from core.deps import DbSession
from core.security import require_permission
from models import AppSettings, User
from schemas.app_settings import AppSettingsResponse, AppSettingsUpdateRequest

public_router = APIRouter(prefix="/api/settings", tags=["设置"])
router = APIRouter(prefix="/settings", tags=["设置"])

_Admin = Annotated[User, Depends(require_permission("api_manage"))]


def _get_row(db) -> AppSettings:
    row = db.get(AppSettings, 1)
    if row is None:
        row = AppSettings(id=1, feedback_hint_enabled=True)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


@public_router.get("/public", response_model=AppSettingsResponse)
def public_settings(db: DbSession) -> AppSettingsResponse:
    return AppSettingsResponse(feedback_hint_enabled=_get_row(db).feedback_hint_enabled)


@router.get("", response_model=AppSettingsResponse)
def read_settings(current_user: _Admin, db: DbSession) -> AppSettingsResponse:
    return AppSettingsResponse(feedback_hint_enabled=_get_row(db).feedback_hint_enabled)


@router.put("", response_model=AppSettingsResponse)
def update_settings(
    req: AppSettingsUpdateRequest,
    current_user: _Admin,
    db: DbSession,
    request: Request,
) -> AppSettingsResponse:
    row = _get_row(db)
    before = row.feedback_hint_enabled
    row.feedback_hint_enabled = req.feedback_hint_enabled
    record(
        db,
        action=ACTION_SETTINGS_UPDATED,
        target_type=TARGET_TYPE_SETTINGS,
        target_id="app",
        target_label="全站开关",
        actor=current_user,
        request=request,
        payload={"feedback_hint_enabled": {"before": before, "after": req.feedback_hint_enabled}},
    )
    db.commit()
    return AppSettingsResponse(feedback_hint_enabled=row.feedback_hint_enabled)
