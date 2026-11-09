from pydantic import BaseModel

from schemas.common import _REQ_CFG, _RESP_CFG


class AppSettingsResponse(BaseModel):
    model_config = _RESP_CFG
    feedback_hint_enabled: bool


class AppSettingsUpdateRequest(BaseModel):
    model_config = _REQ_CFG
    feedback_hint_enabled: bool
