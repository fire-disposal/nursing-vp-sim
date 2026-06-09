from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import get_current_user
from models import TrainingRecord, User
from schemas import OkResponse
from services.feature_flags import FEATURE_FLAGS, resolve_features

router = APIRouter()


class FeaturesResponse(OkResponse):
    features: dict


@router.put("/{record_id}/features", response_model=FeaturesResponse)
def update_training_features(
    record_id: int,
    features: dict,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if record.user_id != current_user.id and not current_user.has_permission("score_review"):
        raise HTTPException(status_code=403, detail="无权限")

    valid_keys = set(FEATURE_FLAGS.keys())
    for k in features:
        if k not in valid_keys:
            raise HTTPException(status_code=400, detail=f"未知功能开关: {k}")

    snapshot = dict(record.config_snapshot or {})
    snapshot["features"] = {**snapshot.get("features", {}), **features}
    record.config_snapshot = snapshot
    db.commit()
    return {"ok": True, "features": resolve_features(record.config_snapshot)}
