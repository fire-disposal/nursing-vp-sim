from fastapi import APIRouter

router = APIRouter(prefix="/api/admin", tags=["管理"])

from .base import router as _base
from .export import router as _export

router.include_router(_base)
router.include_router(_export)
