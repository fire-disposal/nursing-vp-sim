"""病例生成服务——两阶段生成 + 校验-修复循环。

重构要点（原实现：单次大 JSON 一次成型，任一字段失败即整例失败，零测试）：
1. 两阶段生成：clinical core（骨架）→ pedagogical derivative（教学衍生），
   每阶段独立调用、独立校验，质量与成功率更高；full 模式链式执行。
2. 校验-修复循环：阶段校验失败时把错误喂回 LLM 做一次修复，再失败才报错。
3. 字段级生成泛化：任意顶层字段可单独生成/重生成（以当前病例为上下文）。
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from typing import TYPE_CHECKING

from pydantic import ValidationError as PydanticValidationError

from core.exceptions import (
    LLMConcurrencyExceeded,
    LLMError,
    LLMParseError,
    LLMRateLimited,
    NoProviderAvailable,
    NotFoundError,
    ValidationError,
)
from infra.llm.client import CallContext, LLMClient
from infra.llm.profile import get_llm_config
from models import Case, User
from modules.cases.prompts import build_field_instruction, build_system_prompt
from modules.training.pipeline.prompt_context_builder import format_case_for_prompt
from schemas import CaseGenerateRequest, CaseGenerateResponse
from schemas.case_schema import validate_case_data

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

log = logging.getLogger(__name__)


def _build_reference_material(db: Session, data: CaseGenerateRequest) -> str:
    """Assemble reference material from case IDs and/or free‑text."""
    if data.mode != "reference":
        return "无"
    parts: list[str] = []
    if data.reference_case_ids:
        ref_cases = db.query(Case).filter(Case.id.in_(data.reference_case_ids)).all()
        found = {c.id for c in ref_cases}
        missing = [cid for cid in data.reference_case_ids if cid not in found]
        if missing:
            raise NotFoundError(detail=f"参考病例不存在: {missing}")
        for c in ref_cases:
            parts.append(f"--- 参考病例: {c.name} ---\n{format_case_for_prompt(c.case_data)}")
    if data.reference_text:
        parts.append(f"--- 补充参考资料 ---\n{data.reference_text}")
    return "\n\n".join(parts) if parts else "无"


# ── 阶段校验 ───────────────────────────────────────────────────────────────

_CORE_REQUIRED = ("name", "patient_info", "chief_complaint", "present_illness")


def _validate_core_stage(data: dict) -> str | None:
    """临床骨架校验：核心字段非空 + 患者信息完整。返回错误描述或 None。"""
    missing = [f for f in _CORE_REQUIRED if not data.get(f)]
    if missing:
        return f"缺少字段: {', '.join(missing)}"
    pi = data.get("patient_info") or {}
    for k in ("name", "age", "gender"):
        if pi.get(k) in (None, ""):
            return f"patient_info.{k} 缺失"
    if not isinstance(data.get("personality"), dict) or not data["personality"]:
        return "personality 必须是包含维度值的对象"
    return None


def _validate_derivative_stage(data: dict) -> str | None:
    """教学衍生校验：列表字段数量与对象字段类型。返回错误描述或 None。"""

    def _check_list(field: str, lo: int, hi: int) -> str | None:
        v = data.get(field)
        if not isinstance(v, list) or not (lo <= len(v) <= hi):
            return f"{field} 必须是 {lo}-{hi} 条的非空列表"
        return None

    for field, lo, hi in (("hidden_info", 1, 8), ("required_inquiries", 1, 8), ("example_dialogues", 1, 5)):
        err = _check_list(field, lo, hi)
        if err:
            return err
    if not isinstance(data.get("deep_background"), dict):
        return "deep_background 必须是对象（键=主题，值=一句话描述）"
    if not isinstance(data.get("exam_anchors"), dict):
        return "exam_anchors 必须是对象（含 vital_signs）"
    return None


# ── LLM 调用与修复循环 ─────────────────────────────────────────────────────

async def _call_json(
    llm_client: LLMClient,
    messages: list[dict],
    current_user: User,
    description: str,
) -> dict:
    try:
        return await llm_client.call_json(
            messages,
            purpose="case_generation",
            ctx=CallContext(
                purpose="case_generation",
                user_id=current_user.id,
                log_meta={"description": description[:200]},
            ),
            **get_llm_config("case_generation"),
        )
    except (LLMParseError, LLMRateLimited, LLMConcurrencyExceeded, NoProviderAvailable):
        raise
    except Exception as e:
        log.exception("case_generation LLM call failed")
        raise LLMError(f"AI 生成失败: {e!s}")


async def _generate_json_with_repair(
    llm_client: LLMClient,
    messages: list[dict],
    validate: Callable[[dict], str | None],
    current_user: User,
    description: str,
) -> dict:
    """调用 LLM 生成 JSON，校验失败时带错误喂回一次修复。"""
    result = await _call_json(llm_client, messages, current_user, description)
    error = validate(result)
    if error is None:
        return result

    log.info("case_generation repair pass needed: %s", error)
    repair_messages = [
        *messages,
        {"role": "assistant", "content": json.dumps(result, ensure_ascii=False)},
        {"role": "user", "content": f"上次生成的 JSON 存在以下问题：{error}\n请重新生成，只输出修正后的完整 JSON，不要任何解释。"},
    ]
    repaired = await _call_json(llm_client, repair_messages, current_user, description)
    repair_error = validate(repaired)
    if repair_error is not None:
        raise ValidationError(detail=f"AI 生成内容不符合要求: {repair_error}")
    return repaired


def _build_stage_messages(
    stage: str,
    description: str,
    reference_material: str,
    base_case: dict | None,
    field_instruction: str,
) -> list[dict]:
    """组装阶段提示词消息。derivative 阶段把骨架注入参考资料。"""
    material = reference_material
    if stage == "derivative" and base_case:
        material = f"{material}\n\n--- 临床骨架 ---\n{format_case_for_prompt(base_case)}" if material != "无" else format_case_for_prompt(base_case)
    system_content = build_system_prompt(
        stage=stage,
        description=description,
        reference_material=material,
        field_instruction=field_instruction,
    )
    return [{"role": "system", "content": system_content}]


async def _generate_stage(
    stage: str,
    data: CaseGenerateRequest,
    reference_material: str,
    base_case: dict | None,
    current_user: User,
    llm_client: LLMClient,
) -> dict:
    description = data.description or "生成一个护理病史采集训练病例"
    messages = _build_stage_messages(
        stage=stage,
        description=description,
        reference_material=reference_material,
        base_case=base_case,
        field_instruction="",
    )
    validate = _validate_core_stage if stage == "core" else _validate_derivative_stage
    return await _generate_json_with_repair(llm_client, messages, validate, current_user, description)


async def _generate_field(
    data: CaseGenerateRequest,
    reference_material: str,
    current_user: User,
    llm_client: LLMClient,
) -> CaseGenerateResponse:
    field = data.field
    assert field  # caller guarantees
    description = data.description or "生成一个护理病史采集训练病例"
    field_instruction = build_field_instruction(field, data.current_case_data)
    messages = _build_stage_messages(
        stage="core",
        description=description,
        reference_material=reference_material,
        base_case=None,
        field_instruction=field_instruction,
    )
    result = await _call_json(llm_client, messages, current_user, description)
    field_value = result.get("field_value") or result.get(field)
    if field_value is None:
        raise ValidationError(detail=f"未能从 AI 输出中提取字段「{field}」")
    return CaseGenerateResponse(field_value=field_value, field=field)


# ── 公共入口 ───────────────────────────────────────────────────────────────


async def generate_case(
    data: CaseGenerateRequest,
    db: Session,
    current_user: User,
    llm_client: LLMClient,
) -> CaseGenerateResponse:
    """Run the LLM case‑generation workflow."""
    if not data.description.strip():
        raise ValidationError(detail="描述不能为空")

    reference_material = _build_reference_material(db, data)

    # 字段级生成：任意顶层字段单独生成
    if data.field:
        return await _generate_field(data, reference_material, current_user, llm_client)

    stage = data.stage or "full"

    if stage == "core":
        case_data = await _generate_stage("core", data, reference_material, None, current_user, llm_client)
        return CaseGenerateResponse(case_data=case_data)

    if stage == "derivative":
        base = data.current_case_data or {}
        if not base:
            raise ValidationError(detail="生成教学细节需要临床骨架作为上下文（当前病例为空）")
        derivative = await _generate_stage("derivative", data, reference_material, base, current_user, llm_client)
        return CaseGenerateResponse(case_data={**base, **derivative})

    # full：骨架 → 衍生 链式生成
    core = await _generate_stage("core", data, reference_material, None, current_user, llm_client)
    derivative = await _generate_stage("derivative", data, reference_material, core, current_user, llm_client)
    merged = {**core, **derivative}
    try:
        validate_case_data(merged, strict=True)
    except PydanticValidationError as e:
        raise ValidationError(detail=f"病例数据验证失败: {e}")
    return CaseGenerateResponse(case_data=merged)
