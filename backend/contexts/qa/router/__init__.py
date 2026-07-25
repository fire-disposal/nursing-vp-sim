"""QA router — composes endpoints, sessions, and tool definitions."""

from fastapi import APIRouter

from .endpoints import router as _endpoints
from .sessions import router as _sessions

router = APIRouter()
router.include_router(_endpoints)
router.include_router(_sessions)
