"""Physical exam tool handler — vital signs measurement and inspection."""

import logging

from core.exceptions import AuthError, ValidationError
from modules.training.capabilities import is_enabled
from modules.training.tools.physical_exam_rules import handle_operation

from .base import ToolContext, ToolHandler, ToolResult

log = logging.getLogger(__name__)

_VITALS_MAP: dict[str, tuple[str, ...]] = {
    "hr": ("hr",),
    "bp": ("bp_sys", "bp_dia"),
    "rr": ("rr",),
    "spo2": ("spo2",),
    "temp": ("temp",),
    "pain": ("pain",),
}


def _vitals_patch(op_type: str, value: str) -> dict:
    if op_type not in _VITALS_MAP:
        return {}
    fields = _VITALS_MAP[op_type]
    patch: dict[str, float | int] = {}
    if op_type == "bp":
        try:
            parts = value.split("/")
            patch["bp_sys"] = int(parts[0])
            patch["bp_dia"] = int(parts[1])
        except (ValueError, IndexError):
            return {}
    else:
        try:
            val = float(value)
            patch[fields[0]] = int(val) if op_type in ("hr", "rr", "pain") else val
        except ValueError:
            return {}
    return patch


class PhysicalExamHandler(ToolHandler):
    tool_name = "physical_exam"

    async def handle(self, action: str, params: dict, ctx: ToolContext) -> ToolResult:
        if action != "measure":
            return ToolResult(ok=False, error=f"Unknown action: {action}")

        op_type = params.get("op_type", "")
        if not op_type:
            return ToolResult(ok=False, error="Missing op_type")

        record = ctx.record
        if record.user_id != ctx.current_user.id:
            raise AuthError(detail="只能操作自己的训练", status_code=403)
        if record.status != "in_progress":
            raise ValidationError(detail="训练已结束")
        if not is_enabled(record, "physical_exam"):
            raise ValidationError(detail="本次训练未启用护理查体")

        result = handle_operation(op_type, ctx.case_data)

        rs = dict(record.runtime_state or {})
        exam_results = rs.get("exam_results", [])
        if not isinstance(exam_results, list):
            exam_results = []
        entry = {
            "type": op_type,
            "label": result.get("label", ""),
            "value": str(result.get("value", "")),
            "unit": result.get("unit", ""),
        }
        exam_results.append(entry)
        rs["exam_results"] = exam_results

        vitals_patch = _vitals_patch(op_type, str(result.get("value", "")))
        if vitals_patch:
            rs.setdefault("scene", {}).setdefault("vitals", {}).update(vitals_patch)

        record.runtime_state = rs

        return ToolResult(
            ok=True,
            data={
                "op_type": op_type,
                "result": result,
                "all_results": exam_results,
            },
            scene={"vitals": vitals_patch} if vitals_patch else None,
        )
