from fastapi import APIRouter

router = APIRouter(prefix="/api/training", tags=["训练"])

from ._config import router as _config
from .progress import router as _progress
from .scoring import router as _scoring
from .session import router as _session

router.include_router(_session)
router.include_router(_scoring)
router.include_router(_progress)
router.include_router(_config)
