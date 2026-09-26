"""Activity 命令面（HTTP）—— **工具/活动状态变更的唯一写入 owner**。

POST /api/training/{record_id}/tools
  body: { cmd: "physical_exam.measure", params: {...}, idem_key: "...", revision: <int|null> }
  → { ok, data, scene, error, revision }

``cmd`` 拆成 ``(activity_id, command)`` 后交 ``ACTIVITY_BINDINGS`` 分发（见
``modules/training/tools/service.py``），可用性由服务端解析的 Activity 声明决定 ——
这里（以及整条链路）不再读 ``case.tools`` 或旧 capability 表（docs/15 §四/§九）。

写的唯一性（docs/16 §四「一个事实，一个 owner」）：

- **此端点**是 Activity 结果（TrainingAction + runtime_state 键 + NursingRecord 产物）
  的唯一写入路径；WS 只推送事件，SSE 只承载对话回合，都不写 Activity 结果。
- revision 乐观并发：旧版本 409（附当前 revision），结构上消灭 JSONB 无锁覆盖；
- idem_key 幂等：TrainingAction unique(record_id, request_id) 回放；
- 进入 handler 前已持有 ``training_records`` 行锁（``service.execute_tool_command``），
  与 ``session/state.patch_runtime_state`` 的行锁同源，因此工具写入与对话/评分侧的
  runtime_state 写入不会互相覆盖。
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session  # noqa: TC002 — FastAPI 依赖注解需要运行时可见

from core.database import get_db
from core.exceptions import ConflictError, ValidationError
from core.security import get_current_user
from models import Case, TrainingRecord, User
from modules.training.tools.base import ToolContext
from modules.training.tools.service import execute_tool_command

router = APIRouter()


class ToolCommandRequest(BaseModel):
    cmd: str = Field(description='指令全名，如 "physical_exam.measure"')
    params: dict = Field(default_factory=dict)
    idem_key: str = Field(max_length=64, description="客户端幂等键（重试复用同一 key）")
    revision: int | None = Field(default=None, description="上次已知 revision；首次调用可传 null")


class ToolCommandResponse(BaseModel):
    ok: bool
    data: dict
    scene: dict | None = None
    error: str = ""
    revision: int


@router.post("/{record_id}/tools", response_model=ToolCommandResponse)
async def post_tool_command(
    record_id: int,
    body: ToolCommandRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")

    case = db.query(Case).filter(Case.id == record.case_id).first()
    ctx = ToolContext(
        record=record,
        case_data=record.case_snapshot or (case.case_data if case else {}),
        current_user=current_user,
        db=db,
    )
    try:
        result = await execute_tool_command(
            record_id=record_id,
            cmd=body.cmd,
            params=body.params,
            idem_key=body.idem_key,
            revision=body.revision,
            ctx=ctx,
        )
    except ConflictError as e:
        db.rollback()
        current = db.query(TrainingRecord.revision).filter(TrainingRecord.id == record_id).scalar() or 0
        raise HTTPException(
            status_code=409,
            detail={"message": e.detail, "current_revision": current},
        )
    except ValidationError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=e.detail)
    except Exception:
        db.rollback()
        raise

    db.refresh(record)
    return ToolCommandResponse(
        ok=result.ok,
        data=result.data,
        scene=result.scene,
        error=result.error,
        revision=record.revision,
    )
