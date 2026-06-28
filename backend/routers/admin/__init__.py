from fastapi import APIRouter

router = APIRouter(prefix="/api/admin", tags=["管理"])

from .llm_monitor import router as _llm_monitor
from .ops import router as _ops
from .rubrics import router as _rubrics
from .system_notifications import router as _system_notifications
from .users import router as _users

for r in (_llm_monitor, _ops, _rubrics, _system_notifications, _users):
    router.include_router(r)
