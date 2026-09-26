from pydantic import BaseModel


class InitiativeTriggerResponse(BaseModel):
    triggered: bool
    message: str | None = None
    id: int | None = None
    emotion: dict | None = None
