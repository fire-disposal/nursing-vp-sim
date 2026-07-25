from typing import Any

from pydantic import BaseModel


class ScoringTriggerResponse(BaseModel):
    message: str
    record_id: int
    scoring_status: str


class ScoringStatusResponse(BaseModel):
    scoring_status: str | None = None
    scoring_error: str | None = None
    score: dict[str, Any] | None = None
    progress: dict[str, Any] | None = None
