import json
import logging
from contextlib import suppress

from sqlalchemy.orm import Session

from core.config import DEEPSEEK_MODEL, get_llm_config
from models import Message, Score, TrainingRecord
from services.llm_service import call_llm_json
from services.prompt_static import build_scoring_criteria, build_scoring_json_schema
from services.rubric_service import get_rubric_version_id, load_rubric_dict

log = logging.getLogger(__name__)

import httpx


async def _score_stage(
    messages: list[dict],
    record_id: int,
    rubric: dict,
    *,
    user_id: int,
    case_id: int,
    log_meta: dict | None,
    client: httpx.AsyncClient | None,
    router,
    log_worker,
) -> dict:
    """第一阶段：逐项评分（total_score + detail_scores + evidence/reason）。"""
    cfg = get_llm_config("scoring")

    result = await call_llm_json(
        messages,
        purpose="scoring",
        user_id=user_id,
        record_id=record_id,
        case_id=case_id,
        log_meta=log_meta,
        client=client,
        router=router,
        log_worker=log_worker,
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
    result2 = await call_llm_json(
        retry_messages,
        purpose="scoring",
        user_id=user_id,
        record_id=record_id,
        case_id=case_id,
        log_meta=log_meta,
        client=client,
        router=router,
        log_worker=log_worker,
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
    client: httpx.AsyncClient | None,
    router,
    log_worker,
) -> dict:
    """第二阶段：生成反馈（strengths/weaknesses/missed_content/suggestions）。"""
    cfg = get_llm_config("scoring_feedback")

    result = await call_llm_json(
        messages,
        purpose="scoring_feedback",
        user_id=user_id,
        record_id=record_id,
        case_id=case_id,
        log_meta=log_meta,
        client=client,
        router=router,
        log_worker=log_worker,
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
    result2 = await call_llm_json(
        retry_messages,
        purpose="scoring_feedback",
        user_id=user_id,
        record_id=record_id,
        case_id=case_id,
        log_meta=log_meta,
        client=client,
        router=router,
        log_worker=log_worker,
        **cfg,
    )

    try:
        _validate_feedback_fields(result2)
        return result2
    except ValueError:
        pass

    return _merge_feedback(result, result2, missing)


def _check_feedback_empty(result: dict) -> list[str]:
    missing = []
    for field in ("strengths", "weaknesses", "missed_content"):
        if not isinstance(result.get(field), list) or len(result.get(field, [])) == 0:
            missing.append(field)
    if not isinstance(result.get("suggestions"), str) or not result.get("suggestions", "").strip():
        missing.append("suggestions")
    return missing


def _merge_feedback(first: dict, second: dict, missing: list[str]) -> dict:
    merged = dict(first)
    for field in missing:
        val = second.get(field)
        if field in ("strengths", "weaknesses", "missed_content"):
            if isinstance(val, list) and len(val) > 0:
                merged[field] = val
        elif field == "suggestions" and isinstance(val, str) and val.strip():
            merged[field] = val
    return merged


async def evaluate_training(
    record_id: int,
    case_data: dict,
    db: Session,
    *,
    pm,
    router,
    log_worker,
    client: httpx.AsyncClient | None = None,
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
    scoring_json_schema_text = build_scoring_json_schema(rubric)
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
        client=client,
        router=router,
        log_worker=log_worker,
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
        client=client,
        router=router,
        log_worker=log_worker,
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
        model_name=DEEPSEEK_MODEL,
        prompt_version=tmpl_score.version,
        score_scale=100,
    )
    db.add(score)
    db.commit()
    db.refresh(score)
    return score


def _coerce_numeric_fields(obj: dict):
    for key in ("total_score", "score", "max"):
        if key in obj and isinstance(obj[key], str):
            with suppress(ValueError):
                obj[key] = float(obj[key]) if "." in obj[key] else int(obj[key])
    for value in obj.values():
        if isinstance(value, dict):
            _coerce_numeric_fields(value)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    _coerce_numeric_fields(item)


def _validate_scoring_essentials(result: dict):
    """第一阶段校验：仅检查 total_score 和 detail_scores 核心字段。"""
    if "total_score" not in result:
        raise ValueError("缺失字段: total_score")
    if not isinstance(result["total_score"], (int, float)):
        raise TypeError(f"total_score 类型错误: {type(result['total_score']).__name__}")
    if "detail_scores" not in result:
        raise ValueError("缺失字段: detail_scores")
    if not isinstance(result["detail_scores"], dict):
        raise TypeError(f"detail_scores 类型错误: {type(result['detail_scores']).__name__}")


def _validate_feedback_fields(result: dict):
    """第二阶段校验：仅检查四个反馈字段。"""
    empty = _check_feedback_empty(result)
    if empty:
        raise ValueError(
            f"反馈字段不完整: {', '.join([f'{f}(为空)' for f in empty])}"
        )


def _validate_scoring_result(result: dict, rubric: dict | None = None):
    """最终校验：全字段完整性检查。"""
    type_defaults = {
        "strengths": [],
        "weaknesses": [],
        "missed_content": [],
        "suggestions": "",
    }
    for field, default in type_defaults.items():
        if field in result and not isinstance(result[field], type(default)):
            result[field] = default

    _validate_scoring_essentials(result)

    empty_feedback = []
    for field, expected_type in [("strengths", list), ("weaknesses", list), ("missed_content", list), ("suggestions", str)]:
        value = result.get(field)
        if value is None:
            empty_feedback.append(f"{field}(缺失)")
        elif not isinstance(value, expected_type):
            empty_feedback.append(f"{field}(类型错误)")
        elif (expected_type is list and len(value) == 0) or (expected_type is str and not value.strip()):
            empty_feedback.append(f"{field}(为空)")
    if empty_feedback:
        raise ValueError(f"LLM评分反馈字段不完整: {', '.join(empty_feedback)}")

    if rubric:
        total_items = 0
        items_with_evidence = 0
        detail_scores = result.get("detail_scores", {})
        for dim in rubric.get("dimensions", []):
            dim_data = detail_scores.get(dim["name"], {})
            for item in dim_data.get("items", []):
                total_items += 1
                if item.get("evidence"):
                    items_with_evidence += 1
        if total_items > 0 and items_with_evidence / total_items < 0.5:
            log.info(
                "scoring_evidence_warning",
                extra={"items_with_evidence": items_with_evidence, "total_items": total_items},
            )


def _convert_to_100_scale(result: dict, raw_max: int):
    if raw_max == 100 or raw_max <= 0:
        return
    factor = 100.0 / raw_max
    result["total_score"] = round(result["total_score"] * factor)

    detail_scores = result.get("detail_scores", {})
    for dim_data in detail_scores.values():
        if isinstance(dim_data, dict):
            dim_data["score"] = round(dim_data.get("score", 0) * factor)
            dim_data["max"] = round(dim_data.get("max", 0) * factor)
