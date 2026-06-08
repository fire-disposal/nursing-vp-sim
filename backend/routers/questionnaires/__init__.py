from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["问卷"])

from .templates import router as _templates
from .questions import router as _questions
from .responses import router as _responses
from .stats import router as _stats

router.include_router(_templates)
router.include_router(_questions)
router.include_router(_responses)
router.include_router(_stats)
