"""Nursing diagnosis tool — NANDA-based nursing diagnosis formulation and prioritization."""

from __future__ import annotations

import logging

from contexts.training.capabilities import is_enabled

from .base import ToolContext, ToolHandler, ToolResult

log = logging.getLogger(__name__)

# Common NANDA-I nursing diagnosis stems
_DIAGNOSIS_STEMS: list[str] = [
    "清理呼吸道无效",
    "气体交换受损",
    "心输出量减少",
    "组织灌注无效",
    "体液不足",
    "体液过多",
    "营养失调：低于机体需要量",
    "皮肤完整性受损",
    "有感染的危险",
    "体温过高",
    "体温过低",
    "急性疼痛",
    "慢性疼痛",
    "活动无耐力",
    "自理能力缺陷",
    "睡眠形态紊乱",
    "焦虑",
    "恐惧",
    "应对无效",
    "知识缺乏",
    "有受伤的危险",
    "有跌倒的危险",
]

_FACTOR_OPTIONS: list[str] = [
    "呼吸困难/咳嗽",
    "痰液粘稠/过多",
    "疼痛",
    "发热",
    "活动受限",
    "营养不良",
    "年龄因素",
    "慢性病史",
    "用药史",
    "手术/创伤",
    "环境因素",
    "心理因素",
]

_CHARACTERISTIC_OPTIONS: list[str] = [
    "呼吸急促/困难",
    "异常呼吸音",
    "SaO2下降",
    "血压异常",
    "心率异常",
    "体温异常",
    "疼痛主诉/表情",
    "皮肤颜色/温度改变",
    "水肿",
    "意识改变",
    "活动能力下降",
    "食欲/体重变化",
    "睡眠障碍",
    "情绪改变",
]


class NursingDiagnosisHandler(ToolHandler):
    tool_name = "nursing_diagnosis"

    async def handle(self, action: str, params: dict, ctx: ToolContext) -> ToolResult:
        if not is_enabled(ctx.record, "nursing_diagnosis"):
            return ToolResult(ok=False, error="本次训练未启用护理诊断")

        if action == "load":
            return self._load(ctx)

        if action == "save":
            diagnoses = params.get("diagnoses") or []
            return self._save(diagnoses, ctx)

        return ToolResult(ok=False, error=f"Unknown action: {action}")

    def _load(self, ctx: ToolContext) -> ToolResult:
        rs = ctx.record.runtime_state or {}
        saved = rs.get("nursing_diagnoses") or []

        return ToolResult(
            ok=True,
            data={
                "diagnoses": saved if isinstance(saved, list) else [],
                "stems": list(_DIAGNOSIS_STEMS),
                "factor_options": list(_FACTOR_OPTIONS),
                "characteristic_options": list(_CHARACTERISTIC_OPTIONS),
            },
        )

    def _save(self, diagnoses: list, ctx: ToolContext) -> ToolResult:
        rs = dict(ctx.record.runtime_state or {})
        rs["nursing_diagnoses"] = diagnoses
        ctx.record.runtime_state = rs
        ctx.db.flush()

        return ToolResult(ok=True, data={"diagnoses": diagnoses, "saved": True})
