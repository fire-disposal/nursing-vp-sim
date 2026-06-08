from fastapi import APIRouter

router = APIRouter(prefix="/api/training", tags=["训练"])

from .base import router as _base
from .scoring import router as _scoring
from .phases import router as _phases
from .config import router as _config

router.include_router(_base)
router.include_router(_scoring)
router.include_router(_phases)
router.include_router(_config)
