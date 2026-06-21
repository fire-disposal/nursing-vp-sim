import asyncio
import json
import logging
import sys

from sqlalchemy.orm import Session

from core.database import SessionLocal
from core.exceptions import LLMParseError
from core.llm_profile import get_llm_config
from infrastructure.llm.client import CallContext, LLMClient
from infrastructure.prompt import build_scoring_criteria, build_scoring_json_schema
from models import Message, Score, TrainingRecord
from prompts.scoring import FEEDBACK_RETRY_USER, SCORING_RETRY_USER
from repositories.rubric import get_rubric_version_id, load_rubric_by_version

from ._scoring_validation import (
    _check_feedback_empty,
    _coerce_numeric_fields,
    _convert_to_100_scale,
    _merge_feedback,
    _validate_feedback_fields,
    _validate_items_content,
    _validate_scoring_essentials,
    _validate_scoring_result,
)

log = logging.getLogger(__name__)


async def _sse_progress(
    sse_manager, user_id: int, record_id: int, stage: str, pct: int, msg: str, thought: str = ""
) -> None:
    """Publish scoring progress via SSE if sse_manager and user_id are available."""
    if not sse_manager or not user_id:
        return
    try:
        await sse_manager.publish(
            user_id,
            "scoring_progress",
            {
                "record_id": record_id,
                "stage": stage,
                "percent": pct,
                "message": msg,
                "thought": thought,
            },
        )
    except Exception:
        pass


async def _score_stage(
    messages: list[dict],
    record_id: int,
    rubric: dict,
    *,
    user_id: int,
    case_id: int,
    log_meta: dict | None,
    llm_client: LLMClient,
    llm_cfg: dict | None = None,
    tracker=None,  # ScoringProgressTracker | None
    sse_manager=None,
) -> dict:
    """第一阶段：逐项评分（total_score + detail_scores + evidence/reason）。"""
    cfg = llm_cfg or get_llm_config("scoring")

    if tracker:
        tracker.update(record_id, "scoring", 15, "正在逐项评分分析...")

    try:
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
    except (json.JSONDecodeError, LLMParseError, ValueError, TypeError, RuntimeError) as e:
        print(
            f"[SCORING] STAGE1-PARSEFAIL record_id={record_id} error={type(e).__name__}: {str(e)[:200]}",
            file=sys.stderr,
            flush=True,
        )
        log.warning(
            "评分首次调用失败（JSON解析或校验），将触发重试", extra={"record_id": record_id, "error": str(e)[:200]}
        )
        result = {}

    if result:
        try:
            _validate_scoring_essentials(result)
            thought = json.dumps(result, ensure_ascii=False, indent=2)[:3000]
            await _sse_progress(sse_manager, user_id, record_id, "scoring", 55, "评分维度分析完成", thought)
            return result
        except (ValueError, TypeError):
            log.warning("第一次评分校验失败，将触发一次重试", extra={"record_id": record_id})

    partial_json = json.dumps(result, ensure_ascii=False, indent=2) if result else "{}"
    item_errors = _validate_items_content(result.get("detail_scores", {})) if result else ["LLM 未返回有效 JSON"]
    validation_msg = "; ".join(item_errors) if item_errors else "字段缺失或不完整"
    retry_user = SCORING_RETRY_USER.format(
        partial_json=partial_json,
        validation_errors=validation_msg,
    )
    retry_messages = [
        *messages,
        {"role": "assistant", "content": partial_json},
        {"role": "user", "content": retry_user},
    ]
    try:
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
        _validate_scoring_essentials(result2)
        if tracker:
            tracker.update(record_id, "scoring", 55, "评分维度分析完成")
        thought = json.dumps(result2, ensure_ascii=False, indent=2)[:3000]
        await _sse_progress(sse_manager, user_id, record_id, "scoring", 55, "评分维度分析完成", thought)
        return result2
    except Exception as retry_err:
        print(
            f"[SCORING] STAGE1-RETRYFAIL record_id={record_id} error={type(retry_err).__name__}: {str(retry_err)[:200]}",
            file=sys.stderr,
            flush=True,
        )
        log.warning("评分重试也失败", extra={"record_id": record_id}, exc_info=True)
        raise RuntimeError(f"评分解析重试失败 record_id={record_id}") from retry_err


async def _feedback_stage(
    messages: list[dict],
    record_id: int,
    *,
    user_id: int,
    case_id: int,
    log_meta: dict | None,
    llm_client: LLMClient,
    llm_cfg: dict | None = None,
    tracker=None,  # ScoringProgressTracker | None
    sse_manager=None,
) -> dict:
    """第二阶段：生成反馈（strengths/weaknesses/missed_content/suggestions）。"""
    cfg = llm_cfg or get_llm_config("scoring_feedback")

    if tracker:
        tracker.update(record_id, "feedback", 65, "正在生成反馈建议...")

    try:
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
    except (json.JSONDecodeError, LLMParseError, ValueError, TypeError, RuntimeError) as e:
        print(
            f"[SCORING] STAGE2-PARSEFAIL record_id={record_id} error={type(e).__name__}: {str(e)[:200]}",
            file=sys.stderr,
            flush=True,
        )
        log.warning("反馈首次调用失败（JSON解析），将触发重试", extra={"record_id": record_id, "error": str(e)[:200]})
        result = {}

    if result:
        try:
            _validate_feedback_fields(result)
            thought = json.dumps(result, ensure_ascii=False, indent=2)[:3000]
            await _sse_progress(sse_manager, user_id, record_id, "feedback", 90, "反馈建议生成完成", thought)
            return result
        except ValueError as e:
            log.info(
                "scoring_feedback_empty",
                extra={"record_id": record_id, "error": str(e)},
            )

    missing = _check_feedback_empty(result) if result else ["所有字段"]
    if not missing:
        missing = ["strengths", "weaknesses", "missed_content", "suggestions"]
    retry_user = FEEDBACK_RETRY_USER.format(missing=", ".join(missing))
    retry_messages = [
        *messages,
        {"role": "assistant", "content": json.dumps(result, ensure_ascii=False)},
        {"role": "user", "content": retry_user},
    ]
    try:
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
    except Exception as retry_err:
        print(
            f"[SCORING] STAGE2-RETRYFAIL record_id={record_id} error={type(retry_err).__name__}: {str(retry_err)[:200]}",
            file=sys.stderr,
            flush=True,
        )
        log.warning("反馈重试也失败", extra={"record_id": record_id}, exc_info=True)
        raise RuntimeError(f"反馈解析重试失败 record_id={record_id}") from retry_err

    try:
        _validate_feedback_fields(result2)
        if tracker:
            tracker.update(record_id, "feedback", 90, "反馈建议生成完成")
        thought = json.dumps(result2, ensure_ascii=False, indent=2)[:3000]
        await _sse_progress(sse_manager, user_id, record_id, "feedback", 90, "反馈建议生成完成", thought)
        return result2
    except ValueError:
        log.warning("Second feedback retry validation failed: record_id=%d", record_id)

    if tracker:
        tracker.update(record_id, "feedback", 90, "反馈建议生成完成")
    return _merge_feedback(result, result2, missing)


async def evaluate_training(
    record_id: int,
    case_data: dict,
    db: Session,
    *,
    pm,
    llm_client: LLMClient,
    tracker=None,  # ScoringProgressTracker | None
    sse_manager=None,
    user_id: int | None = None,
) -> Score:
    """对训练对话进行评分并保存结果。

    两阶段并行：
      评分（total_score + detail_scores + evidence/reason）
      反馈（strengths/weaknesses/missed_content/suggestions）
    ——同时发起 LLM 调用，约 50% 提速。
    """
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise ValueError("训练记录不存在")

    def _fetch_messages() -> list:
        _db = SessionLocal()
        try:
            return _db.query(Message).filter(Message.record_id == record_id).order_by(Message.created_at).all()
        finally:
            _db.close()

    messages_task = asyncio.to_thread(_fetch_messages)

    if tracker:
        tracker.start(record_id)
        tracker.update(record_id, "loading", 5, "正在加载对话记录...")
    await _sse_progress(sse_manager, user_id, record_id, "loading", 5, "正在加载对话记录...")

    rubric = load_rubric_by_version(record.rubric_frozen or "nursing_history_v1@1.0")
    messages = await messages_task

    conversation_lines = []
    for msg in messages:
        role_label = "学生" if msg.role == "student" else "患者"
        conversation_lines.append(f"{role_label}：{msg.content}")
    conversation_text = "\n\n".join(conversation_lines)

    all_required = case_data.get("required_inquiries", [])
    raw_max = rubric.get("raw_max", 57)

    scoring_criteria_text = build_scoring_criteria(rubric)
    scoring_criteria_text_brief = build_scoring_criteria(rubric, level="brief")
    scoring_json_schema_text = build_scoring_json_schema(rubric, stage="scoring")
    required_inquiries_text = json.dumps(all_required, ensure_ascii=False, indent=2)

    user_id = record.user_id
    case_id = record.case_id
    log_meta = {"message_count": len(messages)}

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

    tmpl_feedback = await pm.get("scoring_feedback")
    feedback_system, feedback_user = tmpl_feedback.render_pair(
        scoring_criteria=scoring_criteria_text_brief,
        required_inquiries=required_inquiries_text,
        conversation_text=conversation_text,
    )
    feedback_messages = [
        {"role": "system", "content": feedback_system},
        {"role": "user", "content": feedback_user},
    ]

    if tracker:
        tracker.update(record_id, "scoring", 10, "正在评分维度分析...")
    await _sse_progress(sse_manager, user_id, record_id, "scoring", 10, "正在评分维度分析...")

    scoring_cfg = get_llm_config("scoring")
    feedback_cfg = get_llm_config("scoring_feedback")

    scoring_task = _score_stage(
        score_messages,
        record_id,
        rubric,
        user_id=user_id,
        case_id=case_id,
        log_meta=log_meta,
        llm_client=llm_client,
        llm_cfg=scoring_cfg,
        tracker=tracker,
        sse_manager=sse_manager,
    )
    feedback_task = _feedback_stage(
        feedback_messages,
        record_id,
        user_id=user_id,
        case_id=case_id,
        log_meta=log_meta,
        llm_client=llm_client,
        llm_cfg=feedback_cfg,
        tracker=tracker,
        sse_manager=sse_manager,
    )

    scoring_result, feedback_result = await asyncio.gather(scoring_task, feedback_task)

    if tracker:
        tracker.update(record_id, "saving", 95, "正在保存评分结果...")
    await _sse_progress(sse_manager, user_id, record_id, "saving", 95, "正在保存评分结果...")

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
