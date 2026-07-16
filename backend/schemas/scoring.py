from datetime import datetime
from typing import Any

from pydantic import BaseModel

from schemas.common import _REQ_CFG, _RESP_CFG


class ScoreReviewRequest(BaseModel):
    model_config = _REQ_CFG
    detail_scores: dict[str, Any] | None = None
    comment: str | None = None


class ScoreReviewResponse(BaseModel):
    model_config = _RESP_CFG
    score_id: int
    review_status: str
    reviewed_by_name: str | None = None
    reviewed_at: datetime | None = None
    original_detail_scores: dict[str, Any] | None = None
    review_detail_scores: dict[str, Any] | None = None
    review_total_score: float | None = None
    review_comment: str | None = None
