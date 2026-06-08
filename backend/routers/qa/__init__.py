from fastapi import APIRouter

router = APIRouter(prefix="/api/qa", tags=["通用问答"])

from .sessions import router as _sessions
from .messages import router as _messages

router.include_router(_sessions)
router.include_router(_messages)
