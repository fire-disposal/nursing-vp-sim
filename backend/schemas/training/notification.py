from datetime import datetime

from pydantic import BaseModel


class TrainingNotificationItem(BaseModel):
    id: int
    type: str
    title: str
    body: str | None = None
    record_id: int | None = None
    is_read: bool = False
    created_at: datetime
