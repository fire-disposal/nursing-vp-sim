"""Activity 命令执行面 —— 唯一入口，处理器表来自 ``ACTIVITY_BINDINGS``。

旧的字符串分发（``registry[handler.tool_name] = handler``）保留为 **transport
adapter**：``cmd "physical_exam.measure"`` → Activity ``physical_exam`` 的 ``measure``
命令。处理器只有一处实例化（``activities.ACTIVITY_BINDINGS``），此表是它的投影，
不复制实现、不另建注册流程。

失败契约在此收口：未知 activity / 未知 command 是客户端错误（400，不进审计）。
"""

from __future__ import annotations

import logging

from fastapi import HTTPException

from core.exceptions import ValidationError
from modules.training.activities import ACTIVITY_BINDINGS

from .base import ToolContext, ToolHandler, ToolResult

log = logging.getLogger(__name__)

#: activity_id → handler（ACTIVITY_BINDINGS 的投影，测试可注入替身）
registry: dict[str, ToolHandler] = {
    activity_id: definition.handler for activity_id, definition in ACTIVITY_BINDINGS.items()
}


async def dispatch(activity_id: str, command: str, params: dict, ctx: ToolContext) -> ToolResult:
    """执行一条 Activity 命令。

    四个 Activity 的失败契约在此收口——handler 只做域逻辑，不再各自返回
    ``ok=False, error="Unknown action: x"``（英文文案、状态码各异的第三通道）。
    """
    handler = registry.get(activity_id)
    if not handler:
        log.warning("Unknown activity requested: %s", activity_id)
        raise ValidationError(detail=f"未知训练工具: {activity_id}")
    if command not in handler.actions:
        log.warning("Unknown command requested: %s.%s", activity_id, command)
        raise ValidationError(detail=f"未知操作: {command}")
    try:
        return await handler.handle(command, params, ctx)
    except HTTPException:
        raise
    except Exception:
        log.exception("Activity handler error: activity=%s command=%s", activity_id, command)
        return ToolResult(ok=False, error="工具操作失败，请稍后重试")
