"""工具指令面 HTTP 端点（Phase 2.5）。

POST /api/training/{record_id}/tools
  body: { cmd: "physical_exam.measure", params: {...}, idem_key: "...", revision: <int|null> }
  → { ok, data, scene, error, revision }

- revision 乐观并发：旧版本 409（附当前 revision），结构上消灭 JSONB 无锁覆盖（T5）；
- idem_key 幂等：TrainingAction unique(record_id, request_id) 回放；
- 工具从 WS 迁出后，WS 仅承载服务端推送事件。
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
