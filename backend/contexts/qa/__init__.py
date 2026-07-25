from fastapi import APIRouter

from .router import router as _router

router = APIRouter(prefix="/api/qa", tags=["通用问答"])
router.include_router(_router)
