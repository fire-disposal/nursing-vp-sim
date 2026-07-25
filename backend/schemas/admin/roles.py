from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG


class RoleCreateRequest(BaseModel):
    model_config = _REQ_CFG
    name: str = Field(min_length=1, max_length=20)
    display_name: str = Field(min_length=1, max_length=40)
    permissions: list[str] = Field(default_factory=list)


class RoleUpdateRequest(BaseModel):
    model_config = _REQ_CFG
    display_name: str | None = Field(default=None, max_length=40)
    permissions: list[str] | None = None


class RoleResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    display_name: str
    is_system: bool = False
    permissions: list[str] = []
    user_count: int = 0
