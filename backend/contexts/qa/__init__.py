from fastapi import APIRouter

router = APIRouter(prefix="/api/qa", tags=["通用问答"])

from ._sessions import router as _sessions
from .api import router as _messages

router.include_router(_sessions)
router.include_router(_messages)
