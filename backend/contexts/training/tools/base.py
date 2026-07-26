from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from models.auth import User
    from models.training import TrainingRecord


@dataclass
class ToolContext:
    record: TrainingRecord
    case_data: dict
    current_user: User
    db: Session


@dataclass
class ToolResult:
    ok: bool
    data: dict[str, Any] = field(default_factory=dict)
    scene: dict[str, Any] | None = None
    error: str = ""


class ToolHandler:
    tool_name: str

    async def handle(self, action: str, params: dict, ctx: ToolContext) -> ToolResult:
        raise NotImplementedError


def get_tool_config(case_data: dict, tool_name: str) -> dict | None:
    """Read tool config from ``case_data.tools.<tool_name>``, with legacy fallback."""
    tools = case_data.get("tools", {}) if isinstance(case_data, dict) else {}
    cfg = tools.get(tool_name)
    if isinstance(cfg, dict):
        return cfg
    # Backward compat: top-level field
    legacy = case_data.get(tool_name) if isinstance(case_data, dict) else None
    return legacy if isinstance(legacy, dict) else None
