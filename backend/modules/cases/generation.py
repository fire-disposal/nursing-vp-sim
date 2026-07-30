"""病例生成服务——接替原来内联在 routers/cases.py 中的 LLM 生成逻辑。"""

from __future__ import annotations

import logging
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
from modules.training.pipeline.prompt_context import PromptContext
from modules.training.pipeline.prompt_context_builder import format_case_for_prompt
from prompts import render_template
from prompts.generation import build_system_prompt
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


def _build_field_instruction(data: CaseGenerateRequest) -> str:
    """Build field‑specific generation instruction."""
    if not data.field:
        return ""
    inst = f"\n\n当前任务：只生成字段「{data.field}」。"
    if data.current_case_data:
        inst += f"\n\n当前病例上下文：\n{format_case_for_prompt(data.current_case_data)}"
    return inst


_TRAINING_TYPE_LABELS: dict[str, str] = {
    "history_taking": "护理病史采集",
    "physical_exam": "护理查体",
    "nursing_operation": "护理操作",
}


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
    field_instruction = _build_field_instruction(data)
    training_type_label = _TRAINING_TYPE_LABELS.get(data.training_type, data.training_type)

    # Assemble prompt via PromptContext
    system_template = build_system_prompt(
        training_type=data.training_type,
        training_type_label=training_type_label,
        description=data.description,
        reference_material=reference_material,
        field_instruction=field_instruction,
    )

    ctx = PromptContext()
    ctx.register(
        "meta",
        {
            "training_type_label": training_type_label,
            "description": data.description or "生成一个护理病史采集训练病例",
            "reference_material": reference_material,
            "field_instruction": field_instruction,
        },
    )
    system_content = render_template(system_template, **ctx.as_dict())

    messages = [{"role": "system", "content": system_content}]

    try:
        result = await llm_client.call_json(
            messages,
            purpose="case_generation",
            ctx=CallContext(
                purpose="case_generation",
                user_id=current_user.id,
                log_meta={"description": data.description[:200] if data.description else None},
            ),
            **get_llm_config("case_generation"),
        )
    except (LLMParseError, LLMRateLimited, LLMConcurrencyExceeded, NoProviderAvailable):
        raise
    except Exception as e:
        log.exception("case_generation LLM call failed")
        raise LLMError(f"AI 生成失败: {e!s}")

    if data.field:
        field_value = result.get("field_value") or result.get(data.field)
        return CaseGenerateResponse(field_value=field_value, field=data.field)

    try:
        result = validate_case_data(result, strict=True)
    except PydanticValidationError as e:
        raise ValidationError(detail=f"病例数据验证失败: {e}")
    return CaseGenerateResponse(case_data=result)
