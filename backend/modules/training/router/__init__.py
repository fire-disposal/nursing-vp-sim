from fastapi import APIRouter

router = APIRouter(prefix="/api/training", tags=["训练"])

from .progress import router as _progress
from .score_review import router as _score_review
from .scoring import router as _scoring
from .session import router as _session
from .session_views import router as _session_views
from .tools import router as _tools
from .ws import router as _ws

router.include_router(_session)
router.include_router(_session_views)
router.include_router(_progress)
router.include_router(_scoring)
router.include_router(_score_review)
router.include_router(_tools)
router.include_router(_ws)
