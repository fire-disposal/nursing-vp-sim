from __future__ import annotations

import logging
from typing import Any, cast

from sqlalchemy.exc import IntegrityError

from core.exceptions import AuthError, ConflictError, ValidationError
from models import TrainingRecord, TrainingToolRequest

from .base import ToolContext, ToolResult
from .registry import dispatch, registry

log = logging.getLogger(__name__)

_READ_ACTIONS = frozenset({"load"})


def _serialize_result(result: ToolResult) -> dict[str, Any]:
    return {
        "ok": result.ok,
        "data": result.data,
        "scene": result.scene,
        "error": result.error,
    }


def _deserialize_result(payload: dict[str, Any]) -> ToolResult:
    raw_data = payload.get("data")
    return ToolResult(
        ok=bool(payload.get("ok")),
        data=cast("dict[str, Any]", raw_data) if isinstance(raw_data, dict) else {},
        scene=payload.get("scene") if isinstance(payload.get("scene"), dict) else None,
        error=str(payload.get("error") or ""),
    )


def _cached_result(
    ctx: ToolContext,
    request_id: str,
    tool_name: str,
    action: str,
) -> ToolResult | None:
    row = (
        ctx.db.query(TrainingToolRequest)
        .filter(
            TrainingToolRequest.record_id == ctx.record.id,
            TrainingToolRequest.request_id == request_id,
        )
        .first()
    )
    if row is None:
        return None
    if row.tool_name != tool_name or row.action != action:
        raise ConflictError(detail="request_id 已用于其他工具操作")
    return _deserialize_result(row.response or {})


def _authorize(ctx: ToolContext, tool_name: str, action: str) -> None:
    if tool_name not in registry:
        raise ValidationError(detail=f"未知训练工具: {tool_name}")

    is_owner = ctx.record.user_id == ctx.current_user.id
    is_read = action in _READ_ACTIONS
    can_review = ctx.current_user.has_permission("score_review")
    if not is_owner and not (is_read and can_review):
        raise AuthError(detail="无权访问此训练记录", status_code=403)
    if not is_read and ctx.record.status != "in_progress":
        raise ValidationError(detail="训练已结束，不能继续操作")

    from modules.training.capabilities import is_enabled

    if not is_enabled(ctx.record, tool_name):
        raise ValidationError(detail=f"本次训练未启用工具: {tool_name}")


async def execute_tool_request(
    *,
    request_id: str,
    tool_name: str,
    action: str,
    params: dict,
    ctx: ToolContext,
) -> ToolResult:
    """Authorize, deduplicate and atomically execute one tool request."""
    if not request_id or len(request_id) > 64:
        raise ValidationError(detail="request_id 缺失或过长")

    _authorize(ctx, tool_name, action)
    if action in _READ_ACTIONS:
        return await dispatch(tool_name, action, params, ctx)

    locked_record = ctx.db.query(TrainingRecord).filter(TrainingRecord.id == ctx.record.id).with_for_update().first()
    if locked_record is None:
        raise ValidationError(detail="训练记录不存在")
    ctx.record = locked_record
    _authorize(ctx, tool_name, action)

    cached = _cached_result(ctx, request_id, tool_name, action)
    if cached is not None:
        log.info(
            "Training tool request deduplicated",
            extra={"record_id": ctx.record.id, "tool": tool_name, "action": action},
        )
        return cached

    request_row = TrainingToolRequest(
        record_id=ctx.record.id,
        request_id=request_id,
        tool_name=tool_name,
        action=action,
        response={},
    )
    ctx.db.add(request_row)
    try:
        ctx.db.flush()
    except IntegrityError:
        ctx.db.rollback()
        cached = _cached_result(ctx, request_id, tool_name, action)
        if cached is None:
            raise ConflictError(detail="重复工具请求仍在处理中")
        return cached

    result = await dispatch(tool_name, action, params, ctx)
    payload = _serialize_result(result)
    if result.ok:
        request_row.response = payload
        # Dual-write: immutable audit timeline for scoring
        from models import TrainingAction

        ctx.db.add(
            TrainingAction(
                record_id=ctx.record.id,
                request_id=request_id,
                kind=tool_name,
                input=params,
                result=payload.get("data") or {},
            )
        )
        ctx.db.commit()
        log.info(
            "Training tool request completed",
            extra={"record_id": ctx.record.id, "tool": tool_name, "action": action},
        )
        return result

    ctx.db.rollback()
    cached = _cached_result(ctx, request_id, tool_name, action)
    if cached is not None:
        return cached

    ctx.db.add(
        TrainingToolRequest(
            record_id=ctx.record.id,
            request_id=request_id,
            tool_name=tool_name,
            action=action,
            response=payload,
        )
    )
    ctx.db.commit()
    log.warning(
        "Training tool request returned error",
        extra={"record_id": ctx.record.id, "tool": tool_name, "action": action, "error": result.error[:200]},
    )
    return result
