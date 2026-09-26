"""护理评估（NursingRecord）请求/响应/错误契约。

生命周期：``draft`` → ``submitted``。提交由学生显式触发并冻结内容；
``status`` 与 ``submitted_at`` 由服务端独占——客户端只能提交内容，不能自封状态。
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG

NursingRecordStatus = Literal["draft", "submitted"]

#: 机器可读错误码（前端据此决定重载/只读/重开草稿，而非匹配中文文案）
NursingRecordErrorCode = Literal[
    "nursing_record_missing",
    "nursing_record_empty",
    "nursing_record_submitted",
    "nursing_record_required",
]


class NursingRecordSave(BaseModel):
    """草稿保存：只写内容，``status`` 恒为 draft（服务端决定）。"""

    model_config = _REQ_CFG
    sheet_data: dict = Field(default_factory=dict)


class NursingRecordSubmit(BaseModel):
    """提交：可选携带最后一次草稿内容——服务端在同一事务里先落盘再冻结。

    ``sheet_data`` 为 ``None`` 时提交服务端已保存的草稿（幂等重放）。
    """

    model_config = _REQ_CFG
    sheet_data: dict | None = None


class NursingRecordResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    record_id: int
    sheet_data: dict
    status: NursingRecordStatus
    submitted_at: datetime | None = None
    updated_at: datetime
    #: 已提交 → False（前端进只读态，需显式 reopen 才能继续编辑）
    editable: bool = True
    missing_fields: list[str] = Field(default_factory=list)


class NursingRecordError(BaseModel):
    """护理评估生命周期错误的统一载荷（``/tools`` 走 ok=false 的 data，``/end`` 走 409 detail）。"""

    model_config = _RESP_CFG
    code: NursingRecordErrorCode
    message: str
    missing_fields: list[str] = Field(default_factory=list)
