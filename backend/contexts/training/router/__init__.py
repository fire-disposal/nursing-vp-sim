from fastapi import APIRouter

router = APIRouter(prefix="/api/training", tags=["训练"])

from ._config import router as _config
from .physical_exam import router as _physical_exam
from .progress import router as _progress
from .score_review import router as _score_review
from .scoring import router as _scoring
from .session import router as _session

router.include_router(_session)
router.include_router(_scoring)
router.include_router(_progress)
router.include_router(_config)
router.include_router(_physical_exam)
router.include_router(_score_review)
