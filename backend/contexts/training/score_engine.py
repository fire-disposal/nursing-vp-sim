import asyncio
import contextlib
import json
import logging
import time
from typing import Any

from sqlalchemy.orm import Session

from core.database import SessionLocal
from core.exceptions import LLMParseError
from core.llm_profile import get_llm_config
from infrastructure.llm import _safe_parse_json
from infrastructure.llm.client import CallContext, LLMClient
from infrastructure.prompt import build_scoring_criteria, build_scoring_json_schema, render_template
from models import Message, Score, TrainingRecord
from prompts.scoring import (
    FEEDBACK_RETRY_USER,
    SCORING_FEEDBACK_SYSTEM,
    SCORING_FEEDBACK_USER,
    SCORING_RETRY_USER,
    SCORING_SYSTEM,
    SCORING_USER,
)
from repositories.rubric import get_rubric_version_id, load_rubric

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


def _safe_truncate_thought(json_str: str, max_chars: int) -> str:
    """Truncate a JSON string at a valid structural boundary.

    Raw slicing `json_str[:max_chars]` can produce invalid JSON when the cut
    falls mid-string or mid-token.  This function tries to truncate by
    reducing detail_scores items; if that fails, it returns a minimal fallback.
    """
    if len(json_str) <= max_chars:
        return json_str
    try:
        data = json.loads(json_str)
        detail_scores = data.get("detail_scores", {})
        if not isinstance(detail_scores, dict):
            return _thought_fallback(len(json_str))
        for dim_data in detail_scores.values():
            if not isinstance(dim_data, dict):
                continue
            items = dim_data.get("items", [])
            if not isinstance(items, list):
                continue
            kept = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                kept.append(
                    {
                        "name": item.get("name", "?"),
                        "score": item.get("score", 0),
                        "max": item.get("max", 0),
                        "evidence": str(item.get("evidence") or "")[:80],
                        "reason": str(item.get("reason") or "")[:80],
                    }
                )
            dim_data["items"] = kept
        data["_truncated"] = True
        result = json.dumps(data, ensure_ascii=False, indent=2)
        if len(result) <= max_chars:
            return result
        # Still too large — strip evidence/reason from all items
        for dim_data in detail_scores.values():
            if not isinstance(dim_data, dict):
                continue
            for item in dim_data.get("items", []):
                if isinstance(item, dict):
                    item.pop("evidence", None)
                    item.pop("reason", None)
        result = json.dumps(data, ensure_ascii=False, indent=2)
        if len(result) <= max_chars:
            return result
    except (json.JSONDecodeError, TypeError, KeyError):
        pass
    return _thought_fallback(len(json_str))


def _thought_fallback(original_len: int) -> str:
    return json.dumps({"_truncated": True, "original_length": original_len}, ensure_ascii=False)


async def _sse_progress(
    sse_manager, user_id: int | None, record_id: int, stage: str, pct: int, msg: str, thought: str = ""
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
        log.warning("SSE publish failed: stage=%s record_id=%d", stage, record_id)


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

    result = await _stream_scoring_attempt(
        llm_client,
        messages,
        record_id,
        cfg,
        user_id=user_id,
        case_id=case_id,
        log_meta=log_meta,
        sse_manager=sse_manager,
        tracker=tracker,
    )

    if result:
        try:
            _validate_scoring_essentials(result)
            thought = _safe_truncate_thought(json.dumps(result, ensure_ascii=False, indent=2), 5000)
            await _sse_progress(sse_manager, user_id, record_id, "scoring", 55, "评分维度分析完成", thought)
            if tracker:
                tracker.update(record_id, "scoring", 55, "评分维度分析完成", thought=thought)
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
    result2 = await _stream_scoring_attempt(
        llm_client,
        retry_messages,
        record_id,
        cfg,
        user_id=user_id,
        case_id=case_id,
        log_meta=log_meta,
        sse_manager=sse_manager,
        tracker=tracker,
    )
    if not result2:
        raise RuntimeError(f"评分解析重试失败 record_id={record_id}")
    try:
        _validate_scoring_essentials(result2)
        thought = _safe_truncate_thought(json.dumps(result2, ensure_ascii=False, indent=2), 3000)
        if tracker:
            tracker.update(record_id, "scoring", 55, "评分维度分析完成", thought=thought)
        await _sse_progress(sse_manager, user_id, record_id, "scoring", 55, "评分维度分析完成", thought)
        return result2
    except Exception as retry_err:
        log.warning(
            "[SCORING] STAGE1-RETRYFAIL record_id=%d error=%s: %s",
            record_id,
            type(retry_err).__name__,
            str(retry_err)[:200],
        )
        raise RuntimeError(f"评分解析重试失败 record_id={record_id}") from retry_err


async def _stream_scoring_attempt(
    llm_client: LLMClient,
    messages: list[dict],
    record_id: int,
    cfg: dict,
    *,
    user_id: int,
    case_id: int,
    log_meta: dict | None,
    sse_manager=None,
    tracker=None,
) -> dict:
    """Stream LLM scoring response — pushes combined reasoning+content as thought every 0.3s."""
    ctx = CallContext(
        purpose="scoring",
        user_id=user_id,
        record_id=record_id,
        case_id=case_id,
        log_meta=log_meta,
    )
    stream_kwargs: dict[str, Any] = {
        "purpose": "scoring",
        "ctx": ctx,
        "enable_thinking": True,
    }
    for key in ("temperature", "max_tokens", "timeout", "max_retries", "response_format"):
        if key in cfg:
            stream_kwargs[key] = cfg[key]

    content_parts: list[str] = []
    thought_buffer: list[str] = []
    last_push = 0.0
    PUSH_INTERVAL = 0.3  # push every 300ms for smooth scrolling
    stream_done = asyncio.Event()

    async def _do_push():
        """Push current thought to SSE+tracker."""
        nonlocal last_push
        text = "".join(thought_buffer[-400:]) if thought_buffer else "▎ 分析中..."
        # Progress: 15% base + up to 38% based on total accumulated
        total_len = sum(len(p) for p in content_parts) + sum(len(p) for p in thought_buffer)
        pct = 15 + int(38 * min(total_len / 3000, 0.9))
        if tracker:
            tracker.update(record_id, "scoring", pct, "正在逐项评分分析...", thought=text)
        await _sse_progress(sse_manager, user_id, record_id, "scoring", pct, "正在逐项评分分析...", text)
        last_push = time.monotonic()

    async def _on_reasoning(text: str) -> None:
        thought_buffer.append(text)
        if time.monotonic() - last_push >= PUSH_INTERVAL:
            await _do_push()

    async def _heartbeat():
        pct = 17
        while not stream_done.is_set():
            await asyncio.sleep(2.0)
            if stream_done.is_set():
                return
            pct = min(pct + 1, 50)
            hb = "".join(thought_buffer[-120:]) if thought_buffer else "▎ 推理中..."
            if tracker:
                tracker.update(record_id, "scoring", pct, "正在逐项评分分析...", thought=hb)
            await _sse_progress(sse_manager, user_id, record_id, "scoring", pct, "正在逐项评分分析...", hb)

    await _sse_progress(sse_manager, user_id, record_id, "scoring", 16, "正在逐项评分分析...", "▎ 启动评分分析...")

    heartbeat_task = asyncio.create_task(_heartbeat())

    try:
        async for chunk in llm_client.stream(messages, on_reasoning=_on_reasoning, **stream_kwargs):
            content_parts.append(chunk)
            # Also feed content into thought buffer when reasoning is sparse
            if not thought_buffer or time.monotonic() - last_push >= PUSH_INTERVAL:
                thought_buffer.append(chunk)
                await _do_push()

        # Flush final accumulated content
        if content_parts and not thought_buffer:
            thought_buffer.extend(content_parts[-5:])
            await _do_push()

        full_text = "".join(content_parts)
        result = _safe_parse_json(full_text)
        _coerce_numeric_fields(result)
        return result
    except (json.JSONDecodeError, LLMParseError, ValueError, TypeError) as e:
        log.warning(
            "评分首次调用失败（JSON解析或校验），将触发重试", extra={"record_id": record_id, "error": str(e)[:200]}
        )
        return {}
    finally:
        stream_done.set()
        heartbeat_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat_task


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

    result = await _stream_feedback_attempt(
        llm_client,
        messages,
        record_id,
        cfg,
        user_id=user_id,
        case_id=case_id,
        log_meta=log_meta,
        sse_manager=sse_manager,
        tracker=tracker,
    )

    if result:
        try:
            _validate_feedback_fields(result)
            thought = _safe_truncate_thought(json.dumps(result, ensure_ascii=False, indent=2), 5000)
            await _sse_progress(sse_manager, user_id, record_id, "feedback", 90, "反馈建议生成完成", thought)
            if tracker:
                tracker.update(record_id, "feedback", 90, "反馈建议生成完成", thought=thought)
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
    result2 = await _stream_feedback_attempt(
        llm_client,
        retry_messages,
        record_id,
        cfg,
        user_id=user_id,
        case_id=case_id,
        log_meta=log_meta,
        sse_manager=sse_manager,
        tracker=tracker,
    )
    if not result2:
        raise RuntimeError(f"反馈解析重试失败 record_id={record_id}")

    try:
        _validate_feedback_fields(result2)
        thought = _safe_truncate_thought(json.dumps(result2, ensure_ascii=False, indent=2), 3000)
        if tracker:
            tracker.update(record_id, "feedback", 90, "反馈建议生成完成", thought=thought)
        await _sse_progress(sse_manager, user_id, record_id, "feedback", 90, "反馈建议生成完成", thought)
        return result2
    except ValueError:
        log.warning("Second feedback retry validation failed: record_id=%d", record_id)

    if tracker:
        tracker.update(record_id, "feedback", 90, "反馈建议生成完成")
    return _merge_feedback(result, result2, missing)


async def _stream_feedback_attempt(
    llm_client: LLMClient,
    messages: list[dict],
    record_id: int,
    cfg: dict,
    *,
    user_id: int,
    case_id: int,
    log_meta: dict | None,
    sse_manager=None,
    tracker=None,
) -> dict:
    """Stream LLM feedback response — pushes combined reasoning+content as thought every 0.3s."""
    ctx = CallContext(
        purpose="scoring_feedback",
        user_id=user_id,
        record_id=record_id,
        case_id=case_id,
        log_meta=log_meta,
    )
    stream_kwargs: dict[str, Any] = {
        "purpose": "scoring_feedback",
        "ctx": ctx,
        "enable_thinking": True,
    }
    for key in ("temperature", "max_tokens", "timeout", "max_retries", "response_format"):
        if key in cfg:
            stream_kwargs[key] = cfg[key]

    content_parts: list[str] = []
    thought_buffer: list[str] = []
    last_push = 0.0
    PUSH_INTERVAL = 0.3
    stream_done = asyncio.Event()

    async def _do_push():
        nonlocal last_push
        text = "".join(thought_buffer[-400:]) if thought_buffer else "▎ 生成中..."
        total_len = sum(len(p) for p in content_parts) + sum(len(p) for p in thought_buffer)
        pct = 65 + int(23 * min(total_len / 2000, 0.9))
        if tracker:
            tracker.update(record_id, "feedback", pct, "正在生成反馈建议...", thought=text)
        await _sse_progress(sse_manager, user_id, record_id, "feedback", pct, "正在生成反馈建议...", text)
        last_push = time.monotonic()

    async def _on_reasoning(text: str) -> None:
        thought_buffer.append(text)
        if time.monotonic() - last_push >= PUSH_INTERVAL:
            await _do_push()

    async def _heartbeat():
        pct = 67
        while not stream_done.is_set():
            await asyncio.sleep(2.0)
            if stream_done.is_set():
                return
            pct = min(pct + 1, 85)
            hb = "".join(thought_buffer[-120:]) if thought_buffer else "▎ 推理中..."
            if tracker:
                tracker.update(record_id, "feedback", pct, "正在生成反馈建议...", thought=hb)
            await _sse_progress(sse_manager, user_id, record_id, "feedback", pct, "正在生成反馈建议...", hb)

    await _sse_progress(sse_manager, user_id, record_id, "feedback", 66, "正在生成反馈建议...", "▎ 启动反馈生成...")

    heartbeat_task = asyncio.create_task(_heartbeat())

    try:
        async for chunk in llm_client.stream(messages, on_reasoning=_on_reasoning, **stream_kwargs):
            content_parts.append(chunk)
            if not thought_buffer or time.monotonic() - last_push >= PUSH_INTERVAL:
                thought_buffer.append(chunk)
                await _do_push()

        if content_parts and not thought_buffer:
            thought_buffer.extend(content_parts[-5:])
            await _do_push()

        full_text = "".join(content_parts)
        result = _safe_parse_json(full_text)
        _coerce_numeric_fields(result)
        return result
    except (json.JSONDecodeError, LLMParseError, ValueError, TypeError) as e:
        log.warning(
            "[SCORING] STAGE2-PARSEFAIL record_id=%d error=%s: %s",
            record_id,
            type(e).__name__,
            str(e)[:200],
        )
        return {}
    finally:
        stream_done.set()
        heartbeat_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat_task


async def evaluate_training(
    record_id: int,
    case_data: dict,
    db: Session,
    *,
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

    rubric = record.rubric_snapshot or load_rubric("nursing_history_v1")
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

    score_system = render_template(
        SCORING_SYSTEM,
        scoring_criteria=scoring_criteria_text,
        required_inquiries=required_inquiries_text,
        scoring_json_schema=scoring_json_schema_text,
        conversation_text=conversation_text,
    )
    score_user = render_template(
        SCORING_USER,
        scoring_criteria=scoring_criteria_text,
        required_inquiries=required_inquiries_text,
        scoring_json_schema=scoring_json_schema_text,
        conversation_text=conversation_text,
    )
    score_messages = [
        {"role": "system", "content": score_system},
        {"role": "user", "content": score_user},
    ]

    feedback_system = render_template(
        SCORING_FEEDBACK_SYSTEM,
        scoring_criteria=scoring_criteria_text_brief,
        required_inquiries=required_inquiries_text,
        conversation_text=conversation_text,
    )
    feedback_user = render_template(
        SCORING_FEEDBACK_USER,
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

    results = await asyncio.gather(scoring_task, feedback_task, return_exceptions=True)
    scoring_result_raw, feedback_result_raw = results

    if isinstance(scoring_result_raw, BaseException):
        if isinstance(feedback_result_raw, BaseException):
            raise scoring_result_raw from feedback_result_raw
        log.warning("评分阶段失败，无可用结果: %s", scoring_result_raw)
        raise scoring_result_raw

    if isinstance(feedback_result_raw, BaseException):
        log.warning("反馈阶段失败，使用空反馈: %s", feedback_result_raw)
        feedback_result_raw = {}

    scoring_result = scoring_result_raw
    feedback_result = feedback_result_raw

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
        prompt_version=0,
        score_scale=100,
    )
    db.add(score)
    db.commit()
    db.refresh(score)
    return score
