from typing import TypeVar

from pydantic import BaseModel, ConfigDict

T = TypeVar("T")

_REQ_CFG = ConfigDict(extra="forbid", str_strip_whitespace=True)
_RESP_CFG = ConfigDict(from_attributes=True)


class PaginatedResponse[T](BaseModel):
    items: list[T]
    total: int
    offset: int
    limit: int


class DeleteResponse(BaseModel):
    ok: bool = True
    message: str = "删除成功"


class MessageResponse(BaseModel):
    message: str


class OkResponse(BaseModel):
    ok: bool = True
    message: str | None = None


class ToggleStatusResponse(BaseModel):
    ok: bool = True
    status: str
