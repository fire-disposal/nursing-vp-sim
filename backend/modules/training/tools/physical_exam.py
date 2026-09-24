"""Physical exam tool handler — vital signs measurement and inspection."""

import logging

from core.exceptions import ValidationError
from modules.training.capabilities import is_enabled
from modules.training.tools.exam_emotion import apply_exam_emotion
from modules.training.tools.physical_exam_rules import handle_operation

from .base import ToolContext, ToolHandler, ToolResult, copy_runtime_state

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
    actions = frozenset({"measure"})

    async def handle(self, action: str, params: dict, ctx: ToolContext) -> ToolResult:
        # action/授权/启用/生命周期由 registry.dispatch + service._authorize 统一校验
        op_type = params.get("op_type", "")
        if not op_type:
            raise ValidationError(detail="缺少 op_type")

        record = ctx.record
        result = handle_operation(op_type, ctx.case_data)

        rs = copy_runtime_state(ctx)
        exam_results = rs.get("exam_results", [])
        if not isinstance(exam_results, list):
            exam_results = []

        # 幂等去重：断线重试场景下，若最近一条测量与本次完全相同
        # （同 op_type + 同值，连续重复），视为客户端重试，直接返回缓存结果，
        # 避免 exam_results 重复条目、情绪事件与审计副作用重复执行。
        last_entry = exam_results[-1] if exam_results else None
        if (
            last_entry
            and isinstance(last_entry, dict)
            and str(last_entry.get("type")) == op_type
            and str(last_entry.get("value")) == str(result.get("value", ""))
        ):
            return ToolResult(
                ok=True,
                data={
                    "op_type": op_type,
                    "result": result,
                    "all_results": exam_results,
                    "duplicated": True,
                },
                scene=None,
            )

        entry = {
            "type": op_type,
            "label": result.get("label", ""),
            "value": str(result.get("value", "")),
            "unit": result.get("unit", ""),
        }
        interpretation = result.get("interpretation")
        if isinstance(interpretation, dict):
            if interpretation.get("status"):
                entry["status"] = interpretation["status"]
            # 解读文案随结果冻结，重进训练时引导模式才能还原教学反馈
            if interpretation.get("text"):
                entry["interpretation"] = interpretation["text"]
        exam_results.append(entry)
        rs["exam_results"] = exam_results

        vitals_patch = _vitals_patch(op_type, str(result.get("value", "")))
        if vitals_patch:
            rs.setdefault("scene", {}).setdefault("vitals", {}).update(vitals_patch)

        record.runtime_state = rs

        data: dict = {
            "op_type": op_type,
            "result": result,
            "all_results": exam_results,
        }

        # 查体 → 情绪桥接（feedback id=30）：异常值/重复测量产生确定性情绪事件。
        # 与查体结果同一事务提交；无事件或情绪禁用时返回 None，不影响查体结果。
        if is_enabled(record, "emotion"):
            same_op_count = sum(1 for item in exam_results if str(item.get("type")) == op_type)
            emotion_patch = apply_exam_emotion(
                record.id,
                ctx.case_data,
                op_type,
                str(result.get("value", "")),
                same_op_count,
                ctx.db,
            )
            if emotion_patch:
                data["emotion"] = emotion_patch

        return ToolResult(
            ok=True,
            data=data,
            scene={"vitals": vitals_patch} if vitals_patch else None,
        )
