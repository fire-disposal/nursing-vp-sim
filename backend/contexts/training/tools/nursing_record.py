"""Nursing record tool handler — ADPIE form storage with patient context prefill."""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from contexts.training.capabilities import is_enabled
from models import NursingRecord

from .base import ToolContext, ToolHandler, ToolResult

log = logging.getLogger(__name__)

_FIELD_LABELS: dict[str, str] = {
    "subjective": "主观资料 (S)",
    "objective": "客观资料 (O)",
    "assessment": "评估 (A)",
    "plan": "计划 (P)",
    "evaluation": "评价 (E)",
}

_HINTS: dict[str, str] = {
    "subjective": "记录患者主诉、症状感受、现病史和既往史要点",
    "objective": "记录生命体征、体格检查结果、实验室数据等客观信息",
    "assessment": "基于收集的信息提出护理诊断，评估风险等级",
    "plan": "制定具体的护理措施、预期目标和健康教育内容",
    "evaluation": "评价措施效果，记录病情变化和后续计划",
}

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
        if nr:
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

        # No saved record yet — build a template from case configuration.
        return ToolResult(ok=True, data=self._build_template(ctx))

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

    def _build_template(self, ctx: ToolContext) -> dict:
        """Build template with fixed hints and patient context prefill."""
        case_data = ctx.case_data or {}
        sheet: dict[str, str] = dict.fromkeys(_FIELD_LABELS, "")
        info = case_data.get("patient_info") or {}
        name = info.get("name", "患者")
        age = info.get("age", "")
        gender = info.get("gender", "")
        chief = case_data.get("chief_complaint", "")
        parts = [f"患者{name}"]
        if age:
            parts.append(f"{age}岁")
        if gender:
            parts.append(gender)
        patient_line = "，".join(parts)
        objective = patient_line
        if chief:
            objective += f"。主诉：{chief}"
        objective += "。\n\n生命体征：\n\n体格检查：\n\n实验室检查："
        sheet["objective"] = objective
        return {
            "id": 0,
            "sheet_data": sheet,
            "status": "draft",
            "template": {"hints": dict(_HINTS), "fields": dict(_FIELD_LABELS)},
        }
