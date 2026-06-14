"""GET /api/plugins/manifest — expose plugin UI metadata to frontend."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from core.database import get_db
from core.feature_flags import resolve_features
from core.security import get_current_user
from models import TrainingRecord, User

from .manager import get_plugin_manager

log = logging.getLogger(__name__)

router = APIRouter(tags=["plugins"])


@router.get("/api/plugins/manifest")
async def plugin_manifest(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
):
    pm = get_plugin_manager()
    return pm.generate_manifest()


@router.get("/api/training/{record_id}/plugins/manifest")
async def training_plugin_manifest(
    record_id: int,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if record is None:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    features = resolve_features(record.practice_snapshot)
    pm = get_plugin_manager()
    return pm.generate_manifest(features)
