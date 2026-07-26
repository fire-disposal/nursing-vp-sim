"""MEWS tool handler — vitals display and interim calculation storage for triage."""

from __future__ import annotations

import logging

from contexts.training.capabilities import is_enabled

from .base import ToolContext, ToolHandler, ToolResult

log = logging.getLogger(__name__)


class MewsHandler(ToolHandler):
    tool_name = "mews"

    async def handle(self, action: str, params: dict, ctx: ToolContext) -> ToolResult:
        if not is_enabled(ctx.record, "mews"):
            return ToolResult(ok=False, error="本次训练未启用 MEWS 评分")

        if action == "load":
            return self._load(ctx)

        if action == "save":
            scores = params.get("scores") or {}
            return self._save(scores, ctx)

        return ToolResult(ok=False, error=f"Unknown action: {action}")

    def _load(self, ctx: ToolContext) -> ToolResult:
        return ToolResult(
            ok=True,
            data={
                "patient_info": ctx.case_data.get("patient_info", {}),
                "red_flags": ctx.case_data.get("red_flags", []),
            },
        )

    def _save(self, scores: dict, ctx: ToolContext) -> ToolResult:
        rs = dict(ctx.record.runtime_state or {})
        rs["mews_calculation"] = scores
        ctx.record.runtime_state = rs
        ctx.db.flush()
        return ToolResult(ok=True, data={"saved": True})
