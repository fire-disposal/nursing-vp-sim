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
    """Workflow 身份投影（id + label + 产品状态）。

    供目录/会话投影展示「这个病例/这次训练属于哪条 workflow」；前端据此选择工作区，
    不自行推导（manifest 里的完整投影见 ``workflow-manifest``，docs/15 §四）。

    ``runtime_ready=False``：该 workflow 已登记、病例可编写可发布可进目录，但**还没有
    学生工作区**（docs/15 §十六）—— 前端不得提供「开始训练」，服务端也会 409 拒绝。
    """

    model_config = _RESP_CFG
    id: str
    label: str
    runtime_ready: bool = True


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
