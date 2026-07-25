from typing import Annotated, Any

from fastapi import APIRouter, Depends

from core.security import require_permission
from models import User
from profiles.rubric_loader import load_rubric

router = APIRouter(prefix="/api/rubrics", tags=["评分标准"])


@router.get("/current")
def get_current_rubric(
    current_user: Annotated[User, Depends(require_permission("score_review"))],
) -> dict[str, Any]:
    return load_rubric()
