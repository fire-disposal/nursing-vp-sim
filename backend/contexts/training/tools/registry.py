from __future__ import annotations

import logging

from .base import ToolContext, ToolHandler, ToolResult

log = logging.getLogger(__name__)

registry: dict[str, ToolHandler] = {}


def register(handler: ToolHandler) -> None:
    registry[handler.tool_name] = handler
    log.info("Registered tool: %s", handler.tool_name)


async def dispatch(tool_name: str, action: str, params: dict, ctx: ToolContext) -> ToolResult:
    handler = registry.get(tool_name)
    if not handler:
        log.warning("Unknown tool requested: %s", tool_name)
        return ToolResult(ok=False, error=f"Unknown tool: {tool_name}")
    try:
        return await handler.handle(action, params, ctx)
    except Exception as e:
        log.exception("Tool handler error: tool=%s action=%s", tool_name, action)
        return ToolResult(ok=False, error=str(e))
