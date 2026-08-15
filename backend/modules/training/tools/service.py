from __future__ import annotations

import logging
from typing import Any, cast

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from core.exceptions import AuthError, ConflictError, ValidationError
from core.statuses import TrainingStatus
from models import TrainingAction, TrainingRecord

from .base import ToolContext, ToolResult
from .registry import dispatch, registry

log = logging.getLogger(__name__)

_READ_ACTIONS = frozenset({"load"})

# 错误动作的审计 kind 后缀——保证评分读 TrainingAction(kind=tool_name) 时
# 不会被错误结果污染（错误路径与成功路径同表不同 kind）
_ERROR_KIND_SUFFIX = ":error"


def parse_cmd(cmd: str) -> tuple[str, str]:
    """把 "physical_exam.measure" 拆成 (tool, action)。纯函数，可测试。"""
    if not cmd or "." not in cmd:
        raise ValidationError(detail=f"指令格式无效: {cmd!r}（应为 tool.action）")
    tool, action = cmd.split(".", 1)
    if not tool or not action:
        raise ValidationError(detail=f"指令格式无效: {cmd!r}（应为 tool.action）")
    return tool, action


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


def _cached_action(ctx: ToolContext, request_id: str) -> tuple[ToolResult | None, str | None]:
    """按 (record_id, request_id) 幂等回放；返回 (结果, 命中的 kind)。"""
    row = (
        ctx.db.query(TrainingAction)
        .filter(TrainingAction.record_id == ctx.record.id, TrainingAction.request_id == request_id)
        .first()
    )
    if row is None:
        return None, None
    if row.kind.endswith(_ERROR_KIND_SUFFIX):
        payload = {"ok": False, "data": {}, "scene": None, "error": (row.result or {}).get("error", "操作失败")}
        return _deserialize_result(payload), row.kind
    return (
        _deserialize_result({"ok": True, "data": row.result or {}, "scene": None, "error": ""}),
        row.kind,
    )


def _authorize(ctx: ToolContext, tool_name: str, action: str) -> None:
    if tool_name not in registry:
        raise ValidationError(detail=f"未知训练工具: {tool_name}")

    is_owner = ctx.record.user_id == ctx.current_user.id
    is_read = action in _READ_ACTIONS
    can_review = ctx.current_user.has_permission("score_review")
    if not is_owner and not (is_read and can_review):
        raise AuthError(detail="无权访问此训练记录", status_code=403)
    if not is_read and ctx.record.status != TrainingStatus.IN_PROGRESS:
        raise ValidationError(detail="训练已结束，不能继续操作")

    from modules.training.capabilities import is_enabled

    if not is_enabled(ctx.record, tool_name):
        raise ValidationError(detail=f"本次训练未启用工具: {tool_name}")


async def execute_tool_command(
    *,
    record_id: int,
    cmd: str,
    params: dict,
    idem_key: str,
    revision: int | None,
    ctx: ToolContext,
) -> ToolResult:
    """工具指令面（HTTP）：授权 → revision 乐观并发 → 幂等回放 → 执行 → 单审计表。

    Phase 2.5（refactor-tools.md）：
    - TrainingAction 同时承担幂等（unique(record_id, request_id)）与域时间线；
    - revision 原子条件自增：`UPDATE ... SET revision=revision+1 WHERE id=:id AND revision=:exp`，
      旧版本请求在此被拒（409 由端点抛出），结构上消灭 JSONB 无锁覆盖（T5）。
    """
    if not idem_key or len(idem_key) > 64:
        raise ValidationError(detail="idem_key 缺失或过长")
    tool_name, action = parse_cmd(cmd)
    if not isinstance(params, dict):
        raise ValidationError(detail="params 必须是对象")

    _authorize(ctx, tool_name, action)
    if action in _READ_ACTIONS:
        return await dispatch(tool_name, action, params, ctx)

    # 行锁 + revision 条件更新（读动作不 bump）
    locked = ctx.db.query(TrainingRecord).filter(TrainingRecord.id == record_id).with_for_update().first()
    if locked is None:
        raise ValidationError(detail="训练记录不存在")
    ctx.record = locked
    _authorize(ctx, tool_name, action)

    if revision is not None and locked.revision != revision:
        raise ConflictError(detail=f"并发冲突：revision 已过期（当前 {locked.revision}，请求 {revision}）")

    return await _claim_and_dispatch(
        record_id, idem_key, tool_name, action, params, ctx, expected_revision=locked.revision
    )


async def _claim_and_dispatch(
    record_id: int,
    idem_key: str,
    tool_name: str,
    action: str,
    params: dict,
    ctx: ToolContext,
    *,
    expected_revision: int,
) -> ToolResult:
    """占位 → 幂等回放 → 执行 → revision 原子推进 → 单审计表落库。"""
    cached, _kind = _cached_action(ctx, idem_key)
    if cached is not None:
        log.info(
            "Training tool command deduplicated",
            extra={"record_id": record_id, "cmd": f"{tool_name}.{action}", "idem_key": idem_key},
        )
        return cached

    placeholder = TrainingAction(
        record_id=record_id,
        request_id=idem_key,
        kind=f"{tool_name}_pending",
        input=params,
        result={},
    )
    ctx.db.add(placeholder)
    try:
        ctx.db.flush()
    except IntegrityError:
        ctx.db.rollback()
        cached, _k2 = _cached_action(ctx, idem_key)
        if cached is not None:
            return cached
        raise ConflictError(detail="重复指令请求仍在处理中")

    result = await dispatch(tool_name, action, params, ctx)
    payload = _serialize_result(result)
    # 原子推进 revision（成功与失败都算一次尝试，前端据此续发）
    new_revision = ctx.db.execute(
        text(
            "UPDATE training_records SET revision = revision + 1 WHERE id = :id AND revision = :exp RETURNING revision"
        ),
        {"id": record_id, "exp": expected_revision},
    ).scalar()
    bumped = new_revision is not None
    if not bumped:
        ctx.db.rollback()
        raise ConflictError(detail="并发冲突：revision 已过期")

    if result.ok:
        placeholder.kind = tool_name
        placeholder.result = payload.get("data") or {}
    else:
        placeholder.kind = f"{tool_name}{_ERROR_KIND_SUFFIX}"
        placeholder.result = {"error": result.error} if result.error else {}
    ctx.db.commit()
    log.info(
        "Training tool command %s: record_id=%d cmd=%s ok=%s",
        "completed" if result.ok else "returned error",
        record_id,
        f"{tool_name}.{action}",
        result.ok,
    )
    return result
