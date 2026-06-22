"""System configuration management — key-value settings overridable via DB."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import require_permission
from models import SystemConfig, User
from schemas.ops import SystemConfigItem

router = APIRouter()


@router.get("/config", response_model=list[SystemConfigItem])
def list_configs(
    current_user: Annotated[User, Depends(require_permission("api_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    configs = db.query(SystemConfig).order_by(SystemConfig.key).all()
    return [{"key": c.key, "value": c.value, "description": c.description} for c in configs]


@router.put("/config/{key}", response_model=SystemConfigItem)
def update_config(
    key: str,
    body: dict,
    current_user: Annotated[User, Depends(require_permission("api_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    config = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    if not config:
        config = SystemConfig(key=key, value=body.get("value"), description=body.get("description", ""))
        db.add(config)
    else:
        config.value = body.get("value")
    db.commit()
    return {"key": config.key, "value": config.value}
