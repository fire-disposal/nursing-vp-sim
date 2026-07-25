from datetime import datetime

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG


class NursingRecordSave(BaseModel):
    model_config = _REQ_CFG
    sheet_data: dict = Field(default_factory=dict)
    status: str = "draft"


class NursingRecordResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    record_id: int
    sheet_data: dict
    status: str
    updated_at: datetime
