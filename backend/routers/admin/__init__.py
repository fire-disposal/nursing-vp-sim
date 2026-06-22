from fastapi import APIRouter

router = APIRouter(prefix="/api/admin", tags=["管理"])

from .base import router as _base
from .export import router as _export
from .ops import router as _ops
from .rubrics import router as _rubrics
from .system_notifications import router as _system_notifications

router.include_router(_base)
router.include_router(_export)
router.include_router(_ops)
router.include_router(_rubrics)
router.include_router(_system_notifications)
