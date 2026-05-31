import json
from sqlalchemy.orm import Session
from models import TrainingRecord, Message, Score
from services.llm_service import call_llm_json
from services.prompt_manager import get_prompt_manager
from config import LLM_SCORING_TIMEOUT, LLM_SCORING_MAX_TOKENS, DEEPSEEK_MODEL
from rubrics import load_rubric, get_rubric_version_id
from prompt_static import build_scoring_rubric
from logger import log_info
import asyncio
import httpx


async def evaluate_training(record_id: int, case_data: dict, db: Session,
                            client: httpx.AsyncClient | None = None,
                            semaphore: asyncio.Semaphore | None = None) -> Score:
    """对训练对话进行评分并保存结果"""
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise ValueError("训练记录不存在")

    messages = db.query(Message).filter(Message.record_id == record_id).order_by(Message.created_at).all()

    conversation_lines = []
    for msg in messages:
        role_label = "学生" if msg.role == "student" else "患者"
        conversation_lines.append(f"{role_label}：{msg.content}")
    conversation_text = "\n\n".join(conversation_lines)

    rubric = load_rubric("nursing_history_v1")
    all_required = case_data.get("required_inquiries", [])
    raw_max = rubric.get("raw_max", rubric.get("total_max", 57))

    scoring_rubric = build_scoring_rubric(rubric, all_required)

    pm = await get_prompt_manager()
    tmpl = await pm.get("scoring")

    system_content, user_content = tmpl.render_pair(
        scoring_rubric=scoring_rubric,
        conversation_text=conversation_text,
    )
    scoring_messages = [
        {"role": "system", "content": system_content},
        {"role": "user", "content": user_content},
    ]
    result = await call_llm_json(scoring_messages, temperature=0.3,
                                   max_tokens=LLM_SCORING_MAX_TOKENS, timeout=LLM_SCORING_TIMEOUT, max_retries=3,
                                   purpose="scoring", user_id=record.user_id,
                                   record_id=record_id, case_id=record.case_id,
                                   log_meta={"message_count": len(messages)},
                                   client=client, semaphore=semaphore)

    # 强制数值字段类型：LLM 可能把数字写成字符串，统一 coerce
    _coerce_numeric_fields(result)

    try:
        _validate_scoring_result(result, rubric)
    except ValueError as e:
        log_info("scoring_parse_failed",
                 extra={"record_id": record_id, "error": str(e),
                        "raw_result": json.dumps(result, ensure_ascii=False)[:8000]})
        raise ValueError(f"LLM评分结果不完整: {e}") from e

    # 将原始 57 分制转换为 100 分制
    raw_max = rubric.get("raw_max", rubric.get("total_max", 57))
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
        prompt_version=2,  # 证据化评分
        score_scale=100,
    )
    db.add(score)
    db.commit()
    db.refresh(score)
    return score


def _coerce_numeric_fields(obj: dict):
    """递归强制数值字段类型：LLM 可能返回 "42" 而非 42，统一转回数字。"""
    for key in ("total_score", "score", "max"):
        if key in obj and isinstance(obj[key], str):
            try:
                if "." in obj[key]:
                    obj[key] = float(obj[key])
                else:
                    obj[key] = int(obj[key])
            except ValueError:
                pass
    for value in obj.values():
        if isinstance(value, dict):
            _coerce_numeric_fields(value)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    _coerce_numeric_fields(item)


def _validate_scoring_result(result: dict, rubric: dict | None = None):
    """校验评分结果的必要字段。对 LLM 可能遗漏的可选字段填默认值，仅核心字段缺失才拒绝。"""
    # 可选字段：LLM 可能遗漏，填默认值而非拒绝
    optional_defaults = {
        "strengths": [],
        "weaknesses": [],
        "missed_content": [],
        "suggestions": "",
    }
    for field, default in optional_defaults.items():
        if field not in result:
            result[field] = default
        elif not isinstance(result[field], type(default)):
            result[field] = default

    # 核心字段：缺失则拒绝
    essential_fields = {
        "total_score": (int, float),
        "detail_scores": dict,
    }
    missing = []
    type_errors = []
    for field, expected_type in essential_fields.items():
        if field not in result:
            missing.append(field)
        elif not isinstance(result[field], expected_type):
            type_errors.append(f"{field}(期望{expected_type.__name__}, 实际{type(result[field]).__name__})")

    if missing or type_errors:
        parts = []
        if missing:
            parts.append(f"缺失字段: {', '.join(missing)}")
        if type_errors:
            parts.append(f"类型错误: {', '.join(type_errors)}")
        raise ValueError(f"LLM评分结果不完整: {'; '.join(parts)}")

    # 软校验 evidence/reason 字段（不阻塞评分，仅告警）
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
            log_info("scoring_evidence_warning",
                     extra={"items_with_evidence": items_with_evidence, "total_items": total_items})


def _convert_to_100_scale(result: dict, raw_max: int):
    """将原始分制（如57分制）的评分结果转换为100分制"""
    if raw_max == 100:
        return
    factor = 100.0 / raw_max
    result["total_score"] = round(result["total_score"] * factor)

    detail_scores = result.get("detail_scores", {})
    for dim_name, dim_data in detail_scores.items():
        if isinstance(dim_data, dict):
            dim_data["score"] = round(dim_data.get("score", 0) * factor)
            dim_data["max"] = round(dim_data.get("max", 0) * factor)
