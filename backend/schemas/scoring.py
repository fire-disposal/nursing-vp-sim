from datetime import datetime
from typing import Any

from pydantic import BaseModel

from schemas.common import _REQ_CFG, _RESP_CFG


class ScoreReviewRequest(BaseModel):
    model_config = _REQ_CFG
    #: 教师编辑的**原始条目**（0-raw_scale）；未知条目与越界分值由服务端收敛
    detail_scores: dict[str, Any] | None = None
    comment: str | None = None


class ScoreReviewResponse(BaseModel):
    model_config = _RESP_CFG
    score_id: int
    review_status: str
    reviewed_by_name: str | None = None
    reviewed_at: datetime | None = None
    #: 展示刻度的 AI 初评（既有消费方沿用）
    original_detail_scores: dict[str, Any] | None = None
    #: 原始刻度的 AI 初评（教师复核编辑的基准；历史记录由展示层反推）
    original_raw_detail_scores: dict[str, Any] | None = None
    review_detail_scores: dict[str, Any] | None = None
    review_total_score: float | None = None
    review_comment: str | None = None
    #: 复核量尺信息：适用原始满分 / 原始量尺 / 基准来源 / 不适用条目
    applicable_raw_max: float | None = None
    raw_scale: int = 2
    review_basis: str | None = None
    not_applicable_items: list[str] = []
