"""Nursing record tool handler — structured assessment form storage."""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from contexts.training.capabilities import is_enabled
from models import NursingRecord

from .base import ToolContext, ToolHandler, ToolResult

log = logging.getLogger(__name__)


class NursingRecordHandler(ToolHandler):
    tool_name = "nursing_record"

    async def handle(self, action: str, params: dict, ctx: ToolContext) -> ToolResult:
        record = ctx.record
        if record.user_id != ctx.current_user.id and not ctx.current_user.has_permission("score_review"):
            return ToolResult(ok=False, error="无权限")
        if not is_enabled(record, "nursing_record"):
            return ToolResult(ok=False, error="本次训练未启用护理评估记录")

        if action == "load":
            return self._load(ctx)

        if action == "save":
            sheet_data = params.get("sheet_data")
            status = params.get("status", "draft")
            if not isinstance(sheet_data, dict):
                return ToolResult(ok=False, error="sheet_data must be a dict")
            return self._save(sheet_data, status, ctx)

        return ToolResult(ok=False, error=f"Unknown action: {action}")

    def _load(self, ctx: ToolContext) -> ToolResult:
        nr = ctx.db.query(NursingRecord).filter(NursingRecord.record_id == ctx.record.id).first()
        if not nr:
            return ToolResult(ok=True, data={"id": 0, "sheet_data": {}, "status": "not_found"})
        if nr.user_id != ctx.current_user.id and not ctx.current_user.has_permission("score_review"):
            return ToolResult(ok=False, error="无权限")
        return ToolResult(
            ok=True,
            data={
                "id": nr.id,
                "sheet_data": nr.sheet_data,
                "status": nr.status,
                "updated_at": nr.updated_at.isoformat() if nr.updated_at else None,
            },
        )

    def _save(self, sheet_data: dict, status: str, ctx: ToolContext) -> ToolResult:
        nr = ctx.db.query(NursingRecord).filter(NursingRecord.record_id == ctx.record.id).first()
        if nr:
            nr.sheet_data = sheet_data
            nr.status = status
            nr.updated_at = datetime.now(UTC)
        else:
            nr = NursingRecord(
                record_id=ctx.record.id,
                user_id=ctx.current_user.id,
                sheet_data=sheet_data,
                status=status or "draft",
            )
            ctx.db.add(nr)

        try:
            ctx.db.commit()
        except Exception:
            ctx.db.rollback()
            raise
        ctx.db.refresh(nr)
        return ToolResult(
            ok=True,
            data={
                "id": nr.id,
                "sheet_data": nr.sheet_data,
                "status": nr.status,
                "updated_at": nr.updated_at.isoformat() if nr.updated_at else None,
            },
        )
