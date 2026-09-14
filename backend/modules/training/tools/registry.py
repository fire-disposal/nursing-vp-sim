from __future__ import annotations

import logging

from fastapi import HTTPException

from core.exceptions import ValidationError

from .base import ToolContext, ToolHandler, ToolResult

log = logging.getLogger(__name__)

registry: dict[str, ToolHandler] = {}


def register(handler: ToolHandler) -> None:
    registry[handler.tool_name] = handler
    log.info("Registered tool: %s", handler.tool_name)


async def dispatch(tool_name: str, action: str, params: dict, ctx: ToolContext) -> ToolResult:
    """工具唯一入口：未知工具/未知 action 是客户端错误（400，不进审计）。

    四个工具的失败契约在此收口——handler 只做域逻辑，不再各自返回
    ``ok=False, error="Unknown action: x"``（英文文案、状态码各异的第三通道）。
    """
    handler = registry.get(tool_name)
    if not handler:
        log.warning("Unknown tool requested: %s", tool_name)
        raise ValidationError(detail=f"未知训练工具: {tool_name}")
    if action not in handler.actions:
        log.warning("Unknown action requested: %s.%s", tool_name, action)
        raise ValidationError(detail=f"未知操作: {action}")
    try:
        return await handler.handle(action, params, ctx)
    except HTTPException:
        raise
    except Exception:
        log.exception("Tool handler error: tool=%s action=%s", tool_name, action)
        return ToolResult(ok=False, error="工具操作失败，请稍后重试")
