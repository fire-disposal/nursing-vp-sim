from typing import Any

from pydantic import BaseModel


class ScoringTriggerResponse(BaseModel):
    message: str
    record_id: int
    scoring_status: str | None
    record_status: str | None = None
    terminal_reason: str | None = None


class ScoringStatusResponse(BaseModel):
    record_status: str | None = None
    scoring_status: str | None = None
    scoring_error: str | None = None
    score: dict[str, Any] | None = None
    progress: dict[str, Any] | None = None
