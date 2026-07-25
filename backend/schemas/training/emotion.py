from pydantic import BaseModel, Field


class EmotionStateResponse(BaseModel):
    trust: int
    comfort: int
    state: str
    note: str
    history: list[dict] = Field(default_factory=list)


class InitiativeStateResponse(BaseModel):
    elapsed_seconds: float
    threshold_seconds: float
    percent: float
    should_trigger: bool = False


class InitiativeTriggerResponse(BaseModel):
    triggered: bool
    message: str | None = None
    id: int | None = None
    emotion: dict | None = None
