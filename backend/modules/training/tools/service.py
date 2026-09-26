from __future__ import annotations

import logging
from typing import Any, cast

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from core.exceptions import AuthError, ConflictError, ValidationError
from core.statuses import TrainingStatus
from models import TrainingAction, TrainingRecord
from modules.training.activities import ACTIVITY_BINDINGS, ActivityDefinition
from modules.training.workflows import workflow_for_record

from .base import ToolContext, ToolResult
from .registry import dispatch

log = logging.getLogger(__name__)

_READ_ACTIONS = frozenset({"load"})

# 错误动作的审计 kind 后缀——保证评分读 TrainingAction(kind=activity_id) 时
# 不会被错误结果污染（错误路径与成功路径同表不同 kind）
_ERROR_KIND_SUFFIX = ":error"


def parse_cmd(cmd: str) -> tuple[str, str]:
    """把 "physical_exam.measure" 拆成 (activity_id, command)。纯函数，可测试。"""
    if not cmd or "." not in cmd:
        raise ValidationError(detail=f"指令格式无效: {cmd!r}（应为 tool.action）")
    activity_id, command = cmd.split(".", 1)
    if not activity_id or not command:
        raise ValidationError(detail=f"指令格式无效: {cmd!r}（应为 tool.action）")
    return activity_id, command


def _validate_params(binding: ActivityDefinition, params: dict) -> dict:
    """按 Activity 声明的 ``inputs_schema`` 校验结构。

    强类型只落在**结构**上（键名与类型）：必填语义与业务文案仍由 handler 抛中文
    错误，保证「单一文案源」，同时结构错误不再逃到域逻辑深处。
    """
    model = binding.inputs_schema
    try:
        validated = model.model_validate(params)
    except Exception as exc:  # pydantic ValidationError → 统一 400 契约
        raise ValidationError(detail=f"参数不合法: {_schema_error_names(exc)}") from exc
    return dict(validated.model_dump())


def _schema_error_names(exc: Exception) -> str:
    errors = getattr(exc, "errors", None)
    if not callable(errors):
        return str(exc)
    return "、".join(str(item.get("loc", ("?",))[-1]) for item in errors())


def _deserialize_result(payload: dict[str, Any]) -> ToolResult:
    raw_data = payload.get("data")
    return ToolResult(
        ok=bool(payload.get("ok")),
        data=cast("dict[str, Any]", raw_data) if isinstance(raw_data, dict) else {},
        scene=payload.get("scene") if isinstance(payload.get("scene"), dict) else None,
        error=str(payload.get("error") or ""),
    )


def _cached_action(ctx: ToolContext, request_id: str) -> tuple[ToolResult | None, str | None]:
    """按 (record_id, request_id) 幂等回放；返回 (结果, 命中的 kind)。

    成功行的 ``result`` 形如 ``{"data": …, "scene": …}``（见 ``_claim_and_dispatch``）——
    回放必须连 ``scene`` 一起还原，否则重试响应 ``ok=true`` 但 ``scene=null``，
    前端监护卡体征不更新（服务端已落库），表现为"测量成功但数值不变"。
    scene 是 vitals **增量 patch**（前端 sceneStore 单层深合并），不是快照：
    快照会把未测量的体征一并推给还在采集史阶段的学生。
    """
    row = (
        ctx.db.query(TrainingAction)
        .filter(TrainingAction.record_id == ctx.record.id, TrainingAction.request_id == request_id)
        .first()
    )
    if row is None:
        return None, None
    stored = row.result or {}
    if row.kind.endswith(_ERROR_KIND_SUFFIX):
        # 业务错误的 data（如 {"code": …}）与其 error 一起回放：客户端重试后
        # 仍需 machine-readable 的错误码，不能只留一句中文文案。
        payload = {
            "ok": False,
            "data": stored.get("data") or {},
            "scene": None,
            "error": stored.get("error", "操作失败"),
        }
        return _deserialize_result(payload), row.kind
    return (
        _deserialize_result(
            {
                "ok": True,
                "data": stored.get("data") or {},
                "scene": stored.get("scene"),
                "error": "",
            }
        ),
        row.kind,
    )


def _authorize(ctx: ToolContext, activity_id: str, command: str) -> ActivityDefinition:
    """授权 + 生命周期 + Activity 可用性闸门（唯一收口处）。

    可用性来自服务端解析（病例声明 ∩ Workflow 白名单 ∩ 作业覆盖），
    不再读 ``case.tools`` 或旧 capability 表。
    """
    binding = ACTIVITY_BINDINGS.get(activity_id)
    if binding is None:
        raise ValidationError(detail=f"未知训练工具: {activity_id}")
    if command not in binding.commands:
        raise ValidationError(detail=f"未知操作: {command}")

    is_owner = ctx.record.user_id == ctx.current_user.id
    is_read = command in _READ_ACTIONS
    can_review = ctx.current_user.has_permission("score_review")
    if not is_owner and not (is_read and can_review):
        raise AuthError(detail="无权访问此训练记录", status_code=403)
    if not is_read and ctx.record.status != TrainingStatus.IN_PROGRESS:
        raise ValidationError(detail="训练已结束，不能继续操作")

    workflow = workflow_for_record(ctx.record)
    enabled = workflow.is_enabled(
        ctx.case_data or {},
        activity_id,
        overrides=(ctx.record.practice_snapshot or {}).get("features"),
    )
    if not enabled:
        raise ValidationError(detail=f"本次训练未启用工具: {activity_id}")
    return binding


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

    2.0 约束：TrainingAction 同时承担幂等（unique(record_id, request_id)）与域时间线；
    revision 原子条件自增，旧版本请求返回 409，避免 JSONB 无锁覆盖。

    **写入 owner**：Activity 结果（TrainingAction + ``runtime_state`` 键 + NursingRecord
    产物）只在此产生；handler 拿到的是行锁内的实例（``with_for_update``），因此整表写回
    是安全的。非工具路径写 ``runtime_state`` 必须走 ``session.state.patch_runtime_state``
    （同一把行锁），否则会把这里的写入整列覆盖掉。
    """
    if not idem_key or len(idem_key) > 64:
        raise ValidationError(detail="idem_key 缺失或过长")
    activity_id, command = parse_cmd(cmd)
    if not isinstance(params, dict):
        raise ValidationError(detail="params 必须是对象")

    binding = _authorize(ctx, activity_id, command)
    params = _validate_params(binding, params)
    if command in _READ_ACTIONS:
        return await dispatch(activity_id, command, params, ctx)

    # 行锁 + revision 条件更新（读动作不 bump）
    locked = ctx.db.query(TrainingRecord).filter(TrainingRecord.id == record_id).with_for_update().first()
    if locked is None:
        raise ValidationError(detail="训练记录不存在")
    ctx.record = locked
    _authorize(ctx, activity_id, command)

    if revision is not None and locked.revision != revision:
        raise ConflictError(detail=f"并发冲突：revision 已过期（当前 {locked.revision}，请求 {revision}）")

    return await _claim_and_dispatch(
        record_id, idem_key, activity_id, command, params, ctx, expected_revision=locked.revision
    )


async def _claim_and_dispatch(
    record_id: int,
    idem_key: str,
    activity_id: str,
    command: str,
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
            extra={"record_id": record_id, "cmd": f"{activity_id}.{command}", "idem_key": idem_key},
        )
        return cached

    placeholder = TrainingAction(
        record_id=record_id,
        request_id=idem_key,
        kind=f"{activity_id}_pending",
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

    result = await dispatch(activity_id, command, params, ctx)
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
        placeholder.kind = activity_id
        # data 与 scene 一起落库：幂等回放要还原完整响应（见 _cached_action）。
        # scoring/engine.py 读该行时取 result["data"]（旧行仍是裸 data dict）。
        placeholder.result = {"data": result.data, "scene": result.scene}
    else:
        placeholder.kind = f"{activity_id}{_ERROR_KIND_SUFFIX}"
        # data 一并落库（业务错误码要能幂等回放，见 _cached_action）
        placeholder.result = {"data": result.data, "error": result.error}
    ctx.db.commit()
    log.info(
        "Activity command %s: record_id=%d cmd=%s ok=%s",
        "completed" if result.ok else "returned error",
        record_id,
        f"{activity_id}.{command}",
        result.ok,
    )
    return result
