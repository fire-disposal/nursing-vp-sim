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


class WorkflowBrief(BaseModel):
    """Workflow 身份投影（id + label）。

    供目录/会话投影展示「这个病例/这次训练属于哪条 workflow」；前端据此选择工作区，
    不自行推导（manifest 里的完整投影见 ``workflow-manifest``，docs/15 §四）。
    """

    model_config = _RESP_CFG
    id: str
    label: str


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
