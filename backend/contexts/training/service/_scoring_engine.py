import json
import logging

from sqlalchemy.orm import Session

from core.config import get_llm_config
from infrastructure.llm.client import LLMClient, CallContext
from models import Message, Score, TrainingRecord
from infrastructure.prompt import build_scoring_criteria, build_scoring_json_schema
from ._scoring_rubric import get_rubric_version_id, load_rubric_dict
from ._scoring_validation import (
    _check_feedback_empty,
    _coerce_numeric_fields,
    _convert_to_100_scale,
    _merge_feedback,
    _validate_feedback_fields,
    _validate_scoring_essentials,
    _validate_scoring_result,
)

log = logging.getLogger(__name__)


async def _score_stage(
    messages: list[dict],
    record_id: int,
    rubric: dict,
    *,
    user_id: int,
    case_id: int,
    log_meta: dict | None,
    llm_client: LLMClient,
) -> dict:
    """第一阶段：逐项评分（total_score + detail_scores + evidence/reason）。"""
    cfg = get_llm_config("scoring")

    result = await llm_client.call_json(
        messages,
        purpose="scoring",
        ctx=CallContext(
            purpose="scoring",
            user_id=user_id,
            record_id=record_id,
            case_id=case_id,
            log_meta=log_meta,
        ),
        **cfg,
    )
    _coerce_numeric_fields(result)

    try:
        _validate_scoring_essentials(result)
        return result
    except ValueError:
        log.warning("第一次评分校验失败，将触发一次重试", extra={"record_id": record_id})

    partial_json = json.dumps(result, ensure_ascii=False, indent=2)
    retry_user = (
        "你上一次的输出格式不完整。请检查每一条目是否都包含 id、name、score、evidence、reason。\n\n"
        f"你上一次的输出：\n```json\n{partial_json}\n```\n\n"
        "请重新输出完整的 JSON，确保所有条目完备。"
    )
    retry_messages = [*messages, {"role": "assistant", "content": partial_json}, {"role": "user", "content": retry_user}]
    result2 = await llm_client.call_json(
        retry_messages,
        purpose="scoring",
        ctx=CallContext(
            purpose="scoring",
            user_id=user_id,
            record_id=record_id,
            case_id=case_id,
            log_meta=log_meta,
        ),
        **cfg,
    )
    _coerce_numeric_fields(result2)
    _validate_scoring_essentials(result2)
    return result2


async def _feedback_stage(
    messages: list[dict],
    scoring_result: dict,
    record_id: int,
    *,
    user_id: int,
    case_id: int,
    log_meta: dict | None,
    llm_client: LLMClient,
) -> dict:
    """第二阶段：生成反馈（strengths/weaknesses/missed_content/suggestions）。"""
    cfg = get_llm_config("scoring_feedback")

    result = await llm_client.call_json(
        messages,
        purpose="scoring_feedback",
        ctx=CallContext(
            purpose="scoring_feedback",
            user_id=user_id,
            record_id=record_id,
            case_id=case_id,
            log_meta=log_meta,
        ),
        **cfg,
    )

    try:
        _validate_feedback_fields(result)
        return result
    except ValueError as e:
        log.info(
            "scoring_feedback_empty",
            extra={"record_id": record_id, "error": str(e)},
        )

    missing = _check_feedback_empty(result)
    partial_json = json.dumps(scoring_result, ensure_ascii=False, indent=2)[:2000]
    retry_user = (
        f"你上一次的输出中，以下反馈字段为空：{', '.join(missing)}。\n\n"
        "请勿重新评分，只补全以上缺失字段。补充时必须引用对话中的具体行为。\n\n"
        f"评分结果（保持不变）：\n```json\n{partial_json}\n```\n\n"
        "请输出 strengths、weaknesses、missed_content、suggestions 四个字段的完整 JSON。"
    )
    retry_messages = [*messages, {"role": "assistant", "content": json.dumps(result, ensure_ascii=False)}, {"role": "user", "content": retry_user}]
    result2 = await llm_client.call_json(
        retry_messages,
        purpose="scoring_feedback",
        ctx=CallContext(
            purpose="scoring_feedback",
            user_id=user_id,
            record_id=record_id,
            case_id=case_id,
            log_meta=log_meta,
        ),
        **cfg,
    )

    try:
        _validate_feedback_fields(result2)
        return result2
    except ValueError:
        pass

    return _merge_feedback(result, result2, missing)


async def evaluate_training(
    record_id: int,
    case_data: dict,
    db: Session,
    *,
    pm,
    llm_client: LLMClient,
) -> Score:
    """对训练对话进行评分并保存结果。

    两阶段流水线：
      第一阶段 → 逐项评分（total_score + detail_scores + evidence/reason）
      第二阶段 → 基于评分结果生成反馈（strengths/weaknesses/missed_content/suggestions）
    """
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise ValueError("训练记录不存在")

    messages = db.query(Message).filter(Message.record_id == record_id).order_by(Message.created_at).all()

    conversation_lines = []
    for msg in messages:
        role_label = "学生" if msg.role == "student" else "患者"
        conversation_lines.append(f"{role_label}：{msg.content}")
    conversation_text = "\n\n".join(conversation_lines)

    rubric = load_rubric_dict()
    all_required = case_data.get("required_inquiries", [])
    raw_max = rubric.get("raw_max", 57)

    scoring_criteria_text = build_scoring_criteria(rubric)
    scoring_json_schema_text = build_scoring_json_schema(rubric, stage="scoring")
    required_inquiries_text = json.dumps(all_required, ensure_ascii=False, indent=2)

    user_id = record.user_id
    case_id = record.case_id
    log_meta = {"message_count": len(messages)}

    # ── 第一阶段：评分 ──
    tmpl_score = await pm.get("scoring")
    score_system, score_user = tmpl_score.render_pair(
        scoring_criteria=scoring_criteria_text,
        required_inquiries=required_inquiries_text,
        scoring_json_schema=scoring_json_schema_text,
        conversation_text=conversation_text,
    )
    score_messages = [
        {"role": "system", "content": score_system},
        {"role": "user", "content": score_user},
    ]
    scoring_result = await _score_stage(
        score_messages, record_id, rubric,
        user_id=user_id,
        case_id=case_id,
        log_meta=log_meta,
        llm_client=llm_client,
    )

    # ── 第二阶段：反馈 ──
    scoring_result_json = json.dumps(scoring_result, ensure_ascii=False, indent=2)
    tmpl_feedback = await pm.get("scoring_feedback")
    feedback_system, feedback_user = tmpl_feedback.render_pair(
        scoring_criteria=scoring_criteria_text,
        required_inquiries=required_inquiries_text,
        scoring_result=scoring_result_json,
        conversation_text=conversation_text,
    )
    feedback_messages = [
        {"role": "system", "content": feedback_system},
        {"role": "user", "content": feedback_user},
    ]
    feedback_result = await _feedback_stage(
        feedback_messages, scoring_result, record_id,
        user_id=user_id,
        case_id=case_id,
        log_meta=log_meta,
        llm_client=llm_client,
    )

    # ── 合并最终结果 ──
    result = {**scoring_result}
    for field in ("strengths", "weaknesses", "missed_content", "suggestions"):
        val = feedback_result.get(field)
        if val is not None:
            result[field] = val

    _coerce_numeric_fields(result)
    _validate_scoring_result(result, rubric)

    _convert_to_100_scale(result, raw_max)

    score = Score(
        record_id=record_id,
        total_score=result["total_score"],
        detail_scores=result["detail_scores"],
        strengths=result["strengths"],
        weaknesses=result["weaknesses"],
        missed_content=result["missed_content"],
        suggestions=result["suggestions"],
        rubric_version=get_rubric_version_id(rubric),
        prompt_version=tmpl_score.version,
        score_scale=100,
    )
    db.add(score)
    db.commit()
    db.refresh(score)
    return score
