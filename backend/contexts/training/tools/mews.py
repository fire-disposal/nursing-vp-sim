"""MEWS tool handler — vitals display and interim calculation storage for triage."""

from __future__ import annotations

import logging

from .base import ToolContext, ToolHandler, ToolResult

log = logging.getLogger(__name__)


class MewsHandler(ToolHandler):
    tool_name = "mews"

    async def handle(self, action: str, params: dict, ctx: ToolContext) -> ToolResult:
        if action == "load":
            return self._load(ctx)

        if action == "save":
            scores = params.get("scores") or {}
            return self._save(scores, ctx)

        return ToolResult(ok=False, error=f"Unknown action: {action}")

    def _load(self, ctx: ToolContext) -> ToolResult:
        vitals = ctx.case_data.get("vitals", {})
        return ToolResult(
            ok=True,
            data={
                "vitals": {
                    "hr": vitals.get("hr", 0),
                    "bp_sys": vitals.get("bp_sys", 0),
                    "bp_dia": vitals.get("bp_dia", 0),
                    "rr": vitals.get("rr", 0),
                    "spo2": vitals.get("spo2", 0),
                    "temp": vitals.get("temp", 0),
                    "consciousness": vitals.get("consciousness", "alert"),
                },
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
