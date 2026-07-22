import asyncio
import contextlib
import json
import logging
import time
from typing import Any

from sqlalchemy.orm import Session

from contexts.training.pipeline.prompt_context import PromptContext
from core.exceptions import LLMParseError
from infrastructure.llm import safe_parse_json
from infrastructure.llm.client import CallContext, LLMClient
from infrastructure.llm.profile import get_enable_thinking, get_llm_config
from infrastructure.llm.prompts.scoring import (
    FEEDBACK_RETRY_USER,
    SCORING_FEEDBACK_SYSTEM,
    SCORING_FEEDBACK_USER,
    SCORING_RETRY_USER,
    SCORING_SYSTEM,
    SCORING_USER,
)
from infrastructure.prompt import build_scoring_criteria, build_scoring_json_schema, render_template
from models import Message, Score, TrainingRecord
from profiles.registry import get_profile
from repositories.rubric import get_rubric_version_id, load_rubric

from ._scoring_validation import (
    _check_feedback_empty,
    _clamp_scores,
    _coerce_numeric_fields,
    _convert_to_100_scale,
    _filter_hallucinated_dimensions,
    _inject_missing_dimensions,
    _inject_rubric_max,
    _merge_feedback,
    _recalc_total_from_dimensions,
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
    realtime_hub, user_id: int | None, record_id: int, stage: str, pct: int, msg: str, thought: str = ""
) -> None:
    """Publish scoring progress via realtime_hub (WS) if hub and user_id are available."""
    if not realtime_hub or not user_id:
        return
    try:
        await realtime_hub.publish(
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
        log.warning("realtime publish failed: stage=%s record_id=%d", stage, record_id)


async def _stream_attempt(
    llm_client: LLMClient,
    messages: list[dict],
    record_id: int,
    cfg: dict,
    *,
    purpose: str,
    user_id: int,
    case_id: int,
    log_meta: dict | None,
    pct_base: int,
    pct_range: int,
    progress_msg: str,
    sse_stage: str,
    realtime_hub=None,
    tracker=None,
) -> dict:
    """Stream LLM response for scoring or feedback — pushes thought every 0.3s."""
    ctx = CallContext(
        purpose=purpose,
        user_id=user_id,
        record_id=record_id,
        case_id=case_id,
        log_meta=log_meta,
    )
    stream_kwargs: dict[str, Any] = {"purpose": purpose, "ctx": ctx, "enable_thinking": get_enable_thinking(purpose)}
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
        text = "".join(thought_buffer[-400:]) if thought_buffer else f"▎ {progress_msg}..."
        total_len = sum(len(p) for p in content_parts) + sum(len(p) for p in thought_buffer)
        pct = pct_base + int(pct_range * min(total_len / 3000, 0.9))
        if tracker:
            tracker.update(record_id, sse_stage, pct, f"正在{progress_msg}...", thought=text)
        await _sse_progress(realtime_hub, user_id, record_id, sse_stage, pct, f"正在{progress_msg}...", text)
        last_push = time.monotonic()

    async def _on_reasoning(text: str) -> None:
        thought_buffer.append(text)
        if time.monotonic() - last_push >= PUSH_INTERVAL:
            await _do_push()

    async def _heartbeat():
        pct = pct_base + 2
        while not stream_done.is_set():
            await asyncio.sleep(2.0)
            if stream_done.is_set():
                return
            pct = min(pct + 1, pct_base + pct_range - 5)
            hb = "".join(thought_buffer[-120:]) if thought_buffer else "▎ 推理中..."
            if tracker:
                tracker.update(record_id, sse_stage, pct, f"正在{progress_msg}...", thought=hb)
            await _sse_progress(realtime_hub, user_id, record_id, sse_stage, pct, f"正在{progress_msg}...", hb)

    await _sse_progress(
        realtime_hub, user_id, record_id, sse_stage, pct_base + 1, f"正在{progress_msg}...", f"▎ 启动{progress_msg}..."
    )

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
        result = safe_parse_json(full_text)
        _coerce_numeric_fields(result)
        return result
    except (json.JSONDecodeError, LLMParseError, ValueError, TypeError) as e:
        log.warning("Stream attempt parse failed: record_id=%d purpose=%s error=%s", record_id, purpose, str(e)[:200])
        return {}
    finally:
        stream_done.set()
        heartbeat_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat_task


async def _stage_with_retry(
    messages: list[dict],
    record_id: int,
    *,
    purpose: str,
    user_id: int,
    case_id: int,
    log_meta: dict | None,
    llm_client: LLMClient,
    llm_cfg: dict,
    validate_fn,
    retry_prompt_template: str,
    pct_base: int,
    pct_range: int,
    progress_msg: str,
    sse_stage: str,
    realtime_hub=None,
    tracker=None,
    fallback_fn=None,
) -> dict:
    """Single scoring stage with retry."""
    if tracker:
        tracker.update(record_id, sse_stage, pct_base, f"正在{progress_msg}...")

    result = await _stream_attempt(
        llm_client,
        messages,
        record_id,
        llm_cfg,
        purpose=purpose,
        user_id=user_id,
        case_id=case_id,
        log_meta=log_meta,
        pct_base=pct_base,
        pct_range=pct_range,
        progress_msg=progress_msg,
        sse_stage=sse_stage,
        realtime_hub=realtime_hub,
        tracker=tracker,
    )

    if result:
        try:
            validate_fn(result)
            thought = _safe_truncate_thought(json.dumps(result, ensure_ascii=False, indent=2), 5000)
            await _sse_progress(
                realtime_hub, user_id, record_id, sse_stage, pct_base + pct_range - 5, f"{progress_msg}完成", thought
            )
            if tracker:
                tracker.update(record_id, sse_stage, pct_base + pct_range - 5, f"{progress_msg}完成", thought=thought)
            return result
        except (ValueError, TypeError):
            log.warning("First attempt validation failed, retrying: record_id=%d purpose=%s", record_id, purpose)

    partial_json = json.dumps(result, ensure_ascii=False, indent=2) if result else "{}"
    item_errors = _validate_items_content(result.get("detail_scores", {})) if result else ["LLM 未返回有效 JSON"]
    validation_msg = "; ".join(item_errors) if item_errors else "字段缺失或不完整"

    missing_list = _check_feedback_empty(result) if result else ["所有字段"]
    if not missing_list:
        missing_list = ["strengths", "weaknesses", "missed_content", "suggestions"]
    missing = ", ".join(missing_list)

    retry_user = render_template(
        retry_prompt_template,
        partial_json=partial_json,
        validation_errors=validation_msg,
        missing=missing,
    )
    retry_msgs = [
        *messages,
        {"role": "assistant", "content": partial_json},
        {"role": "user", "content": retry_user},
    ]

    result2 = await _stream_attempt(
        llm_client,
        retry_msgs,
        record_id,
        llm_cfg,
        purpose=purpose,
        user_id=user_id,
        case_id=case_id,
        log_meta=log_meta,
        pct_base=pct_base,
        pct_range=pct_range,
        progress_msg=progress_msg,
        sse_stage=sse_stage,
        realtime_hub=realtime_hub,
        tracker=tracker,
    )
    if not result2:
        if fallback_fn:
            return fallback_fn(result, {}, missing_list)
        raise RuntimeError(f"Stage failed after retry: record_id={record_id} purpose={purpose}")

    try:
        validate_fn(result2)
        thought = _safe_truncate_thought(json.dumps(result2, ensure_ascii=False, indent=2), 3000)
        if tracker:
            tracker.update(record_id, sse_stage, pct_base + pct_range - 5, f"{progress_msg}完成", thought=thought)
        await _sse_progress(
            realtime_hub, user_id, record_id, sse_stage, pct_base + pct_range - 5, f"{progress_msg}完成", thought
        )
        return result2
    except Exception as retry_err:
        if fallback_fn:
            log.warning("Feedback retry also failed, merging partial results: record_id=%d", record_id)
            return fallback_fn(result, result2, missing_list)
        log.warning("Scoring retry failed: record_id=%d error=%s", record_id, str(retry_err)[:200])
        raise RuntimeError(f"Scoring stage failed: record_id={record_id}") from retry_err


async def evaluate_training(
    record_id: int,
    case_data: dict,
    db: Session,
    *,
    llm_client: LLMClient,
    tracker=None,  # ScoringProgressTracker | None
    realtime_hub=None,
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

    messages = db.query(Message).filter(Message.record_id == record_id).order_by(Message.created_at).all()

    if tracker:
        tracker.start(record_id)
        tracker.update(record_id, "loading", 5, "正在加载对话记录...")
    await _sse_progress(realtime_hub, user_id, record_id, "loading", 5, "正在加载对话记录...")

    rubric = record.rubric_snapshot
    if not rubric:
        try:
            profile = get_profile(record.training_type or "history_taking")
            base_rubric = profile.rubric
        except KeyError:
            base_rubric = load_rubric("nursing_history_v1")
        from contexts.training.rubric_builder import build_final_rubric

        features = (record.practice_snapshot or {}).get("features", {})
        rubric = build_final_rubric(base_rubric, features)

    conversation_lines = []
    for msg in messages:
        role_label = "学生" if msg.role == "student" else "患者"
        conversation_lines.append(f"{role_label}：{msg.content}")
    conversation_text = "\n\n".join(conversation_lines)

    training_type = getattr(record, "training_type", None) or "history_taking"
    all_required = case_data.get("required_inquiries", [])
    raw_max = rubric.get("raw_max", 57)

    scoring_criteria_text = build_scoring_criteria(rubric)
    scoring_criteria_text_brief = build_scoring_criteria(rubric, level="brief")
    scoring_json_schema_text = build_scoring_json_schema(rubric, stage="scoring")
    required_inquiries_text = json.dumps(all_required, ensure_ascii=False, indent=2)

    user_id = record.user_id
    case_id = record.case_id
    log_meta = {"message_count": len(messages)}

    # 反馈块无条件引用 exam_results_text；triage 分支不设置它，故此处预置默认，
    # 避免 triage 评分时 UnboundLocalError（此前被 gather(return_exceptions=True) 吞掉导致 triage 无反馈）
    exam_results_text = ""

    if training_type == "triage":
        triage_result = (record.runtime_state or {}).get("triage_result", {})
        actions_parts = []
        if triage_result:
            actions_parts.append(f"学生计算的MEWS评分：{triage_result.get('mews_score', '未计算')}")
            actions_parts.append(f"学生选择的分诊级别：{triage_result.get('category', '未选择')}")
            actions_parts.append(f"学生推荐的目标科室：{triage_result.get('department', '未选择')}")
            notes = triage_result.get("notes", "")
            if notes:
                actions_parts.append(f"备注：{notes}")
        student_actions_text = "\n".join(actions_parts) if actions_parts else "学生未提交分诊结果"

        from profiles.triage.builder import build_context_kwargs

        profile = get_profile("triage")
        pc = PromptContext()
        pc.register("case", build_context_kwargs(case_data))
        pc.register("actions", {"student_actions": student_actions_text})
        prompt_kw = pc.as_dict()

        score_system = render_template(str(profile.prompts.scoring), **prompt_kw)
        score_user = render_template(str(profile.prompts.scoring_user), **prompt_kw)
    else:
        exam_results_raw = (record.runtime_state or {}).get("exam_results", [])
        exam_results_text = (
            json.dumps(exam_results_raw, ensure_ascii=False, indent=2) if exam_results_raw else "学生未执行任何查体操作"
        )

        # 护理记录评分注入：nursing_record 能力开启时，将学生填写的 sheet_data 注入评分 prompt
        # [DISABLED] 护理评估记录评分暂时禁用 — 恢复时取消下方注释
        nursing_record_text = ""
        # features = (record.practice_snapshot or {}).get("features", {})
        # if features.get("nursing_record"):
        #     nr = db.query(NursingRecord).filter(NursingRecord.record_id == record.id).first()
        #     if nr and nr.sheet_data:
        #         parts = []
        #         for field in ("subjective", "objective", "assessment", "plan", "evaluation"):
        #             val = nr.sheet_data.get(field, "")
        #             if val:
        #                 parts.append(f"{field.upper()}: {val}")
        #         nursing_record_text = "\n\n".join(parts) if parts else ""
        #     scoring_criteria_text = f"{scoring_criteria_text}\n\n## 学生提交的护理评估记录\n{nursing_record_text}"

        pc = PromptContext()
        pc.register(
            "scoring",
            {
                "scoring_criteria": scoring_criteria_text,
                "required_inquiries": required_inquiries_text,
                "scoring_json_schema": scoring_json_schema_text,
                "conversation_text": conversation_text,
                "exam_results": exam_results_text,
                "nursing_record": nursing_record_text,
            },
        )
        prompt_kw = pc.as_dict()
        score_system = render_template(SCORING_SYSTEM, **prompt_kw)
        score_user = render_template(SCORING_USER, **prompt_kw)
    score_messages = [
        {"role": "system", "content": score_system},
        {"role": "user", "content": score_user},
    ]

    fb_ctx = PromptContext()
    fb_ctx.register(
        "feedback",
        {
            "scoring_criteria": scoring_criteria_text_brief,
            "required_inquiries": required_inquiries_text,
            "conversation_text": conversation_text,
            "exam_results": exam_results_text,
            "nursing_record": nursing_record_text,
        },
    )
    fb_kw = fb_ctx.as_dict()
    feedback_system = render_template(SCORING_FEEDBACK_SYSTEM, **fb_kw)
    feedback_user = render_template(SCORING_FEEDBACK_USER, **fb_kw)
    feedback_messages = [
        {"role": "system", "content": feedback_system},
        {"role": "user", "content": feedback_user},
    ]

    if tracker:
        tracker.update(record_id, "scoring", 10, "正在评分维度分析...")
    await _sse_progress(realtime_hub, user_id, record_id, "scoring", 10, "正在评分维度分析...")

    scoring_cfg = get_llm_config("scoring")
    feedback_cfg = get_llm_config("scoring_feedback")

    scoring_task = _stage_with_retry(
        score_messages,
        record_id,
        purpose="scoring",
        user_id=user_id,
        case_id=case_id,
        log_meta=log_meta,
        llm_client=llm_client,
        llm_cfg=scoring_cfg,
        validate_fn=_validate_scoring_essentials,
        retry_prompt_template=SCORING_RETRY_USER,
        pct_base=15,
        pct_range=38,
        progress_msg="逐项评分分析",
        sse_stage="scoring",
        tracker=tracker,
        realtime_hub=realtime_hub,
        fallback_fn=_fallback_scoring,
    )
    feedback_task = _stage_with_retry(
        feedback_messages,
        record_id,
        purpose="scoring_feedback",
        user_id=user_id,
        case_id=case_id,
        log_meta=log_meta,
        llm_client=llm_client,
        llm_cfg=feedback_cfg,
        validate_fn=_validate_feedback_fields,
        retry_prompt_template=FEEDBACK_RETRY_USER,
        pct_base=65,
        pct_range=23,
        progress_msg="生成反馈建议",
        sse_stage="feedback",
        tracker=tracker,
        realtime_hub=realtime_hub,
        fallback_fn=_merge_feedback,
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
    await _sse_progress(realtime_hub, user_id, record_id, "saving", 95, "正在保存评分结果...")

    result = {**scoring_result}
    for field in ("strengths", "weaknesses", "missed_content", "suggestions"):
        val = feedback_result.get(field)
        if val is not None:
            result[field] = val

    _inject_rubric_max(result, rubric)
    _coerce_numeric_fields(result)

    rubric_dim_names = {d["name"] for d in rubric.get("dimensions", [])}
    result["detail_scores"] = _filter_hallucinated_dimensions(result.get("detail_scores", {}), rubric_dim_names)
    _clamp_scores(result.get("detail_scores", {}), raw_scale=rubric.get("raw_scale", 3))
    _inject_missing_dimensions(result.get("detail_scores", {}), rubric)
    recalc_total = _recalc_total_from_dimensions(result.get("detail_scores", {}), raw_scale=rubric.get("raw_scale", 3))
    if abs(recalc_total - float(result.get("total_score", 0))) > 2:
        log.warning(
            "total_score_mismatch",
            extra={"llm_total": result["total_score"], "recalc_total": recalc_total},
        )
        result["total_score"] = recalc_total

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


def _fallback_scoring(first: dict, second: dict, missing_list: list[str] | None = None) -> dict:
    """Fallback when scoring LLM fails after retry.

    Preserves the partial first-attempt result so the parallel feedback
    result (which may have succeeded) is not discarded by asyncio.gather.
    """
    if first:
        first["_scoring_fallback"] = True
        return first
    return {"total_score": 0, "detail_scores": {}, "_scoring_fallback": True}
