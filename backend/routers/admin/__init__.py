from fastapi import APIRouter

router = APIRouter(prefix="/api/admin", tags=["管理"])

from .llm_monitor import router as _llm_monitor
from .ops import router as _ops
from .rubrics import router as _rubrics
from .system_notifications import router as _system_notifications
from .users import router as _users

router.include_router(_users)
router.include_router(_llm_monitor)
router.include_router(_ops)
router.include_router(_rubrics)
router.include_router(_system_notifications)
