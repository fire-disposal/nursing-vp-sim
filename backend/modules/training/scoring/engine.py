import asyncio
import contextlib
import json
import logging
import time
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from core.exceptions import LLMParseError
from core.statuses import ScoringStatus
from core.template import render_template
from infra.llm import safe_parse_json
from infra.llm.client import CallContext, LLMClient
from infra.llm.profile import get_enable_thinking, get_llm_config
from models import Message, NursingRecord, Score, TrainingRecord
from modules.training.pipeline.prompt_context import PromptContext
from modules.training.profile import PROFILE
from modules.training.prompts.scoring import (
    FEEDBACK_RETRY_USER,
    SCORING_FEEDBACK_SYSTEM,
    SCORING_FEEDBACK_USER,
    SCORING_RETRY_USER,
    SCORING_SYSTEM,
    SCORING_USER,
)
from modules.training.scoring.rubric_loader import get_rubric_version_id

from .prompt_builder import build_scoring_criteria, build_scoring_json_schema
from .validation import (
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

# ── 常量 ──
THOUGHT_PUSH_INTERVAL_SEC = 0.3
HEARTBEAT_INTERVAL_SEC = 2.0
THOUGHT_TRUNCATE_SUCCESS = 5000
THOUGHT_TRUNCATE_RETRY = 3000
TOTAL_SCORE_MISMATCH_TOLERANCE = 2
DEFAULT_RAW_MAX = 38  # 19 条目 × raw_scale 2（0-2 制）
SCORING_PCT_BASE = 15
SCORING_PCT_RANGE = 38
FEEDBACK_PCT_BASE = 65
FEEDBACK_PCT_RANGE = 23
SCORING_START_PCT = 10
SAVING_PCT = 95
PER_STAGE_TIMEOUT_SEC = 150
# S8: 评分阶段预算 = 全局超时 - 余量（两阶段并行共享同一全局窗口，
# 单阶段（首试+重试）不得超过该预算；重试超时优先走 fallback 而非拖垮全局）
SCORING_BUDGET_MARGIN_SECONDS = 15
# S9: 评分输入消息上限（与 chat 上下文一致，防长对话 token 爆炸）
SCORING_MAX_MESSAGES = 120

log = logging.getLogger(__name__)


@dataclass
class StageConfig:
    """Progress context collapsed into one object to reduce param threading."""

    pct_base: int
    pct_range: int
    progress_msg: str
    sse_stage: str
    record_id: int
    user_id: int | None = None
    realtime_hub: Any = None
    tracker: Any = None


def _safe_truncate_thought(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 3] + "..."


async def _sse_progress(stage: StageConfig, pct: int, msg: str, thought: str = "") -> None:
    if not stage.realtime_hub or not stage.user_id:
        return
    try:
        await stage.realtime_hub.publish(
            stage.user_id,
            "scoring_progress",
            {
                "record_id": stage.record_id,
                "stage": stage.sse_stage,
                "percent": pct,
                "message": msg,
                "thought": thought,
            },
        )
    except Exception:
        log.warning("realtime publish failed: stage=%s record_id=%d", stage.sse_stage, stage.record_id)


def _tracker_update(stage: StageConfig, pct: int, msg: str, thought: str = "") -> None:
    if stage.tracker:
        stage.tracker.update(stage.record_id, stage.sse_stage, pct, msg, thought=thought)


async def _stream_attempt(
    llm_client: LLMClient,
    messages: list[dict],
    cfg: dict,
    *,
    stage: StageConfig,
    purpose: str,
    case_id: int,
    log_meta: dict | None,
) -> dict:
    """Stream LLM response.  Pushes *thinking* tokens to SSE, never content chunks."""
    ctx = CallContext(
        purpose=purpose, user_id=stage.user_id, record_id=stage.record_id, case_id=case_id, log_meta=log_meta
    )
    stream_kwargs: dict[str, Any] = {"purpose": purpose, "ctx": ctx, "enable_thinking": get_enable_thinking(purpose)}
    for key in ("temperature", "max_tokens", "timeout", "response_format"):
        if key in cfg:
            stream_kwargs[key] = cfg[key]
    # T2：客户端级流式重试置 0——流式中断重试会把已发 chunk 从头重放造成重复；
    # 重试由 _stage_with_retry 用全新 stream 调用完成。
    stream_kwargs["max_retries"] = 0

    content_parts: list[str] = []
    thought_buffer: list[str] = []
    last_push = 0.0
    stream_done = asyncio.Event()

    async def _do_push():
        nonlocal last_push
        text = "".join(thought_buffer[-400:]) if thought_buffer else f"▎ {stage.progress_msg}..."
        pct = stage.pct_base + min(int(stage.pct_range * 0.3), stage.pct_range - 5)
        _tracker_update(stage, pct, f"正在{stage.progress_msg}...", thought=text)
        await _sse_progress(stage, pct, f"正在{stage.progress_msg}...", text)
        last_push = time.monotonic()

    async def _on_reasoning(text: str) -> None:
        thought_buffer.append(text)
        if time.monotonic() - last_push >= THOUGHT_PUSH_INTERVAL_SEC:
            await _do_push()

    async def _heartbeat():
        pct = stage.pct_base + 2
        while not stream_done.is_set():
            await asyncio.sleep(HEARTBEAT_INTERVAL_SEC)
            if stream_done.is_set():
                return
            pct = min(pct + 1, stage.pct_base + stage.pct_range - 5)
            hb = "".join(thought_buffer[-120:]) if thought_buffer else "▎ 推理中..."
            _tracker_update(stage, pct, f"正在{stage.progress_msg}...", thought=hb)
            await _sse_progress(stage, pct, f"正在{stage.progress_msg}...", hb)

    await _sse_progress(stage, stage.pct_base + 1, f"正在{stage.progress_msg}...", f"▎ 启动{stage.progress_msg}...")
    _tracker_update(stage, stage.pct_base + 1, f"正在{stage.progress_msg}...", thought=f"▎ 启动{stage.progress_msg}...")

    heartbeat_task = asyncio.create_task(_heartbeat())
    full_text = ""

    try:
        async for chunk in llm_client.stream(messages, on_reasoning=_on_reasoning, **stream_kwargs):
            content_parts.append(chunk)

        full_text = "".join(content_parts)
        result = safe_parse_json(full_text)
        _coerce_numeric_fields(result)
        return result
    except (json.JSONDecodeError, LLMParseError, ValueError, TypeError) as e:
        log.warning(
            "Stream attempt parse failed: record_id=%d purpose=%s len=%d head=%r tail=%r error=%s",
            stage.record_id,
            purpose,
            len(full_text),
            full_text[:200],
            full_text[-200:],
            str(e)[:200],
        )
        return {}
    finally:
        stream_done.set()
        heartbeat_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat_task


async def _stage_with_retry(
    messages: list[dict],
    *,
    stage: StageConfig,
    purpose: str,
    case_id: int,
    log_meta: dict | None,
    llm_client: LLMClient,
    llm_cfg: dict,
    validate_fn,
    retry_prompt_template: str,
    fallback_fn=None,
    budget_seconds: float,
) -> dict:
    """Single scoring stage with retry.  Per-stage timeout = min(150s, 剩余预算)。

    S8：全局超时（SCORING_TIMEOUT_SECONDS）约束整次评分（两阶段并行共享）；
    单阶段（首试+重试）预算 = 全局 - 余量。重试超时优先走 fallback，
    不再出现"重试必然被全局超时杀死"的矛盾。
    """
    _tracker_update(stage, stage.pct_base, f"正在{stage.progress_msg}...")
    deadline = time.monotonic() + budget_seconds

    async def _try_once(msgs: list[dict]) -> dict:
        remaining = max(15.0, deadline - time.monotonic())
        timeout = min(PER_STAGE_TIMEOUT_SEC, remaining)
        return await asyncio.wait_for(
            _stream_attempt(
                llm_client, msgs, llm_cfg, stage=stage, purpose=purpose, case_id=case_id, log_meta=log_meta
            ),
            timeout=timeout,
        )

    result = await _try_once(messages)

    if result:
        try:
            validate_fn(result)
            thought = _safe_truncate_thought(json.dumps(result, ensure_ascii=False, indent=2), THOUGHT_TRUNCATE_SUCCESS)
            done_pct = stage.pct_base + stage.pct_range - 5
            _tracker_update(stage, done_pct, f"{stage.progress_msg}完成", thought=thought)
            await _sse_progress(stage, done_pct, f"{stage.progress_msg}完成", thought)
            return result
        except (ValueError, TypeError):
            log.warning("First attempt validation failed, retrying: record_id=%d purpose=%s", stage.record_id, purpose)

    partial_json = json.dumps(result, ensure_ascii=False, indent=2) if result else ""
    item_errors = (
        _validate_items_content(result.get("detail_scores", {}))
        if result
        else ["LLM 流式响应解析失败，未获得任何 JSON 数据"]
    )
    validation_msg = "; ".join(item_errors) if item_errors else "字段缺失或不完整"

    missing_list = _check_feedback_empty(result) if result else ["所有字段"]
    if not missing_list:
        missing_list = ["strengths", "weaknesses", "missed_content", "suggestions"]
    missing = ", ".join(missing_list)

    retry_user = render_template(
        retry_prompt_template,
        partial_json=partial_json or "(上轮响应为空，需要重新生成完整 JSON)",
        validation_errors=validation_msg,
        missing=missing,
    )
    retry_msgs = [*messages]
    if partial_json:
        retry_msgs.append({"role": "assistant", "content": partial_json})
    retry_msgs.append({"role": "user", "content": retry_user})

    try:
        result2 = await _try_once(retry_msgs)
    except TimeoutError:
        if fallback_fn:
            return fallback_fn(result, {}, missing_list)
        raise RuntimeError(f"Stage timeout after retry: record_id={stage.record_id} purpose={purpose}")

    if not result2:
        if fallback_fn:
            return fallback_fn(result, {}, missing_list)
        raise RuntimeError(f"Stage failed after retry: record_id={stage.record_id} purpose={purpose}")

    try:
        validate_fn(result2)
        thought = _safe_truncate_thought(json.dumps(result2, ensure_ascii=False, indent=2), THOUGHT_TRUNCATE_RETRY)
        done_pct = stage.pct_base + stage.pct_range - 5
        _tracker_update(stage, done_pct, f"{stage.progress_msg}完成", thought=thought)
        await _sse_progress(stage, done_pct, f"{stage.progress_msg}完成", thought)
        return result2
    except Exception as retry_err:
        if fallback_fn:
            log.warning("Stage retry validation still failed: record_id=%d purpose=%s", stage.record_id, purpose)
            return fallback_fn(result, result2, missing_list)
        raise RuntimeError(f"Scoring stage failed: record_id={stage.record_id}") from retry_err


async def _load_record_and_messages(
    db: Session, record_id: int, tracker, realtime_hub, user_id: int | None
) -> tuple[TrainingRecord, list[Message]]:
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise ValueError("训练记录不存在")
    all_messages = db.query(Message).filter(Message.record_id == record_id).order_by(Message.created_at).all()
    # S9: 与 chat 上下文一致，截断到最近 SCORING_MAX_MESSAGES 条（保留时间顺序）
    messages = all_messages[-SCORING_MAX_MESSAGES:] if len(all_messages) > SCORING_MAX_MESSAGES else all_messages
    if len(all_messages) > SCORING_MAX_MESSAGES:
        log.warning(
            "scoring history truncated: record_id=%d total=%d kept=%d",
            record_id,
            len(all_messages),
            len(messages),
        )
    if tracker:
        tracker.start(record_id)
        tracker.update(record_id, "loading", 5, "正在加载对话记录...")
    if realtime_hub and user_id:
        with contextlib.suppress(Exception):
            await realtime_hub.publish(
                user_id,
                "scoring_progress",
                {
                    "record_id": record_id,
                    "stage": "loading",
                    "percent": 5,
                    "message": "正在加载对话记录...",
                    "thought": "",
                },
            )
    return record, messages


def _resolve_rubric(db: Session, record: TrainingRecord) -> dict:
    rubric = record.rubric_snapshot
    if not rubric:
        base_rubric = PROFILE.rubric
        from .rubric import build_final_rubric

        features = (record.practice_snapshot or {}).get("features", {})
        rubric = build_final_rubric(base_rubric, features)
    return rubric


def _format_conversation(messages: list[Message]) -> str:
    conversation_lines = []
    for msg in messages:
        role_label = "学生" if msg.role == "student" else "患者"
        conversation_lines.append(f"{role_label}：{msg.content}")
    return "\n\n".join(conversation_lines)


def _prepare_scoring_texts(rubric: dict, case_data: dict) -> tuple[str, str, str, str]:
    all_required = case_data.get("required_inquiries", [])
    scoring_criteria_text = build_scoring_criteria(rubric)
    scoring_criteria_text_brief = build_scoring_criteria(rubric, level="brief")
    scoring_json_schema_text = build_scoring_json_schema(rubric, stage="scoring")
    required_inquiries_text = json.dumps(all_required, ensure_ascii=False, indent=2)
    return scoring_criteria_text, scoring_criteria_text_brief, scoring_json_schema_text, required_inquiries_text


def _load_nursing_record_text(db: Session, record: TrainingRecord) -> str:
    """护理记录评分注入：nursing_record 能力开启时，读取学生填写的 sheet_data 并格式化。"""
    features = (record.practice_snapshot or {}).get("features", {})
    if not features.get("nursing_record"):
        return ""
    nr = db.query(NursingRecord).filter(NursingRecord.record_id == record.id).first()
    if not nr or not nr.sheet_data:
        return ""
    parts = []
    for field_name in ("subjective", "objective", "assessment", "plan", "evaluation"):
        val = nr.sheet_data.get(field_name, "")
        if val:
            parts.append(f"{field_name.upper()}: {val}")
    return "\n\n".join(parts)


def _build_history_messages(
    db: Session,
    record: TrainingRecord,
    scoring_criteria_text: str,
    required_inquiries_text: str,
    scoring_json_schema_text: str,
    conversation_text: str,
    nursing_record_text: str = "",
) -> tuple[list[dict], str, str]:
    # Prefer TrainingAction audit timeline; fall back to legacy runtime_state
    from models import TrainingAction

    actions = (
        db.query(TrainingAction)
        .filter(TrainingAction.record_id == record.id, TrainingAction.kind == "physical_exam")
        .order_by(TrainingAction.created_at)
        .all()
    )
    if actions:
        exam_results_raw = [a.result for a in actions]
    else:
        exam_results_raw = (record.runtime_state or {}).get("exam_results", [])
        if exam_results_raw:
            log.info("Scoring using legacy runtime_state exam_results: record_id=%d", record.id)
    exam_results_text = (
        json.dumps(exam_results_raw, ensure_ascii=False, indent=2) if exam_results_raw else "学生未执行任何查体操作"
    )

    if nursing_record_text:
        scoring_criteria_text = f"{scoring_criteria_text}\n\n## 学生提交的护理评估记录\n{nursing_record_text}"

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
    return score_messages, exam_results_text, nursing_record_text


def _build_feedback_messages(
    scoring_criteria_text_brief: str,
    required_inquiries_text: str,
    conversation_text: str,
    exam_results_text: str,
    nursing_record_text: str,
) -> list[dict]:
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
    return [
        {"role": "system", "content": feedback_system},
        {"role": "user", "content": feedback_user},
    ]


_FEEDBACK_DEFAULTS = {
    "strengths": [],
    "weaknesses": [],
    "missed_content": [],
    "suggestions": "",
}


def _postprocess_scoring_result(scoring_result: dict, feedback_result: dict, rubric: dict) -> dict:
    result = {**scoring_result}
    for field in ("strengths", "weaknesses", "missed_content", "suggestions"):
        val = feedback_result.get(field)
        if val is not None:
            result[field] = val
        else:
            result.setdefault(field, _FEEDBACK_DEFAULTS[field])

    # S3: 全空兜底（LLM 双次失败）——跳过注入/换算，保留 0 分 + llm_empty 标记
    if result.get("fallback", {}).get("kind") == "llm_empty":
        result["raw_total"] = 0
        result["dim_total"] = {}
        return result

    _inject_rubric_max(result, rubric)
    _coerce_numeric_fields(result)

    rubric_dim_names = {d["name"] for d in rubric.get("dimensions", [])}
    result["detail_scores"] = _filter_hallucinated_dimensions(result.get("detail_scores", {}), rubric_dim_names)
    _clamp_scores(result.get("detail_scores", {}), raw_scale=rubric.get("raw_scale", 3))
    injected_dims = _inject_missing_dimensions(result.get("detail_scores", {}), rubric)
    if injected_dims:
        # S4: 维度静默丢失 → 显式 fallback 标记（不再是静默 0 分）
        result["fallback"] = {"kind": "dims_injected", "dims": injected_dims}
        log.warning("scoring dims injected: %s", injected_dims, extra={"record_id": result.get("_record_id")})

    # S2: 总分 = Σ条目分（raw），dim_total 为 LLM 维度自评快照（展示用）
    raw_scale = rubric.get("raw_scale", 3)
    raw_total = _recalc_total_from_dimensions(result.get("detail_scores", {}), raw_scale)
    result["raw_total"] = raw_total
    result["dim_total"] = {
        name: {"score": d.get("score"), "max": d.get("max")}
        for name, d in result.get("detail_scores", {}).items()
        if isinstance(d, dict)
    }

    if result.get("_scoring_fallback"):
        log.warning(
            "scoring fallback: keeping LLM total_score, bypassing dimension recalculation",
            extra={"llm_total": result.get("total_score")},
        )
    elif abs(raw_total - float(result.get("total_score", 0))) > TOTAL_SCORE_MISMATCH_TOLERANCE:
        original_total = float(result.get("total_score", 0))
        if raw_total == 0.0 and original_total > 0:
            log.warning(
                "total_score_mismatch_dim_zero: recalc=0 while LLM gave non-zero, keeping LLM value",
                extra={"original_llm_total": original_total, "recalc_total": raw_total},
            )
        else:
            log.warning(
                "total_score_mismatch",
                extra={"llm_total": result["total_score"], "recalc_total": raw_total},
            )
            result["total_score"] = raw_total

    _validate_scoring_result(result, rubric)

    injected_count = len(injected_dims)
    total_dims = len(rubric.get("dimensions", []))
    if total_dims > 0 and injected_count == total_dims:
        result["_scoring_fallback"] = True
        result.setdefault("fallback", {"kind": "all_dims_injected"})
        log.warning(
            "scoring_all_dims_injected: record_id=%d total_score=%s",
            result.get("_record_id", "?"),
            result.get("total_score"),
        )

    raw_max = rubric.get("raw_max", DEFAULT_RAW_MAX)
    _convert_to_100_scale(result, raw_max)
    return result


def _persist_score(result: dict, rubric: dict, record_id: int, db: Session) -> Score | None:
    # Guard: timeout handler may have already marked scoring_status='failed'.
    # Don't write an orphan Score that won't match the record status.
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if record and record.scoring_status not in (ScoringStatus.PROCESSING, ScoringStatus.PENDING, None):
        log.warning(
            "评分结果已过期（状态=%s），不写入孤儿 Score",
            record.scoring_status,
            extra={"record_id": record_id},
        )
        return None

    from infra.llm.profile import get_model
    from modules.training.pipeline.snapshot_compat import read_prompt_snapshot

    snapshot = read_prompt_snapshot(record.prompt_snapshot if record else None)
    score = Score(
        record_id=record_id,
        total_score=result["total_score"],
        detail_scores=result["detail_scores"],
        strengths=result["strengths"],
        weaknesses=result["weaknesses"],
        missed_content=result["missed_content"],
        suggestions=result["suggestions"],
        rubric_version=get_rubric_version_id(rubric),
        model_name=get_model("scoring"),
        prompt_version=snapshot.schema_version if snapshot else 1,
        # Phase 1 契约：raw_total/fallback/dim_total 落库（S2/S3/S4）
        raw_total=result.get("raw_total"),
        mapping_version=1 if result.get("raw_total") is not None else 0,
        fallback=result.get("fallback"),
        dim_total=result.get("dim_total"),
    )
    db.add(score)
    db.commit()
    db.refresh(score)
    return score


async def evaluate_training(
    record_id: int,
    case_data: dict,
    db: Session,
    *,
    llm_client: LLMClient,
    tracker=None,  # ScoringProgressTracker | None
    realtime_hub=None,
    user_id: int | None = None,
) -> Score | None:
    """对训练对话进行评分并保存结果。

    两阶段并行：
      评分（total_score + detail_scores + evidence/reason）
      反馈（strengths/weaknesses/missed_content/suggestions）
    —    —同时发起 LLM 调用，约 50% 提速。
    """
    record, messages = await _load_record_and_messages(db, record_id, tracker, realtime_hub, user_id)
    rubric = _resolve_rubric(db, record)
    conversation_text = _format_conversation(messages)

    scoring_criteria_text, scoring_criteria_text_brief, scoring_json_schema_text, required_inquiries_text = (
        _prepare_scoring_texts(rubric, case_data)
    )
    nursing_record_text = _load_nursing_record_text(db, record)
    score_messages, exam_results_text, nursing_record_text = _build_history_messages(
        db,
        record,
        scoring_criteria_text,
        required_inquiries_text,
        scoring_json_schema_text,
        conversation_text,
        nursing_record_text,
    )

    feedback_messages = _build_feedback_messages(
        scoring_criteria_text_brief, required_inquiries_text, conversation_text, exam_results_text, nursing_record_text
    )

    uid = record.user_id
    case_id = record.case_id
    log_meta = {"message_count": len(messages)}

    scoring_stage = StageConfig(
        pct_base=SCORING_PCT_BASE,
        pct_range=SCORING_PCT_RANGE,
        progress_msg="逐项评分分析",
        sse_stage="scoring",
        record_id=record_id,
        user_id=uid,
        realtime_hub=realtime_hub,
        tracker=tracker,
    )
    feedback_stage = StageConfig(
        pct_base=FEEDBACK_PCT_BASE,
        pct_range=FEEDBACK_PCT_RANGE,
        progress_msg="生成反馈建议",
        sse_stage="feedback",
        record_id=record_id,
        user_id=uid,
        realtime_hub=realtime_hub,
        tracker=tracker,
    )

    _tracker_update(scoring_stage, SCORING_START_PCT, "正在评分维度分析...")
    await _sse_progress(scoring_stage, SCORING_START_PCT, "正在评分维度分析...")

    scoring_cfg = get_llm_config("scoring")
    feedback_cfg = get_llm_config("scoring_feedback")

    # S8: 两阶段并行共享全局超时窗口，单阶段预算 = 全局 - 余量
    from core.config import SCORING_TIMEOUT_SECONDS

    stage_budget = max(60.0, float(SCORING_TIMEOUT_SECONDS) - SCORING_BUDGET_MARGIN_SECONDS)

    scoring_coro = _stage_with_retry(
        score_messages,
        stage=scoring_stage,
        purpose="scoring",
        case_id=case_id,
        log_meta=log_meta,
        llm_client=llm_client,
        llm_cfg=scoring_cfg,
        validate_fn=_validate_scoring_essentials,
        retry_prompt_template=SCORING_RETRY_USER,
        fallback_fn=_fallback_scoring,
        budget_seconds=stage_budget,
    )
    feedback_coro = _stage_with_retry(
        feedback_messages,
        stage=feedback_stage,
        purpose="scoring_feedback",
        case_id=case_id,
        log_meta=log_meta,
        llm_client=llm_client,
        llm_cfg=feedback_cfg,
        validate_fn=_validate_feedback_fields,
        retry_prompt_template=FEEDBACK_RETRY_USER,
        fallback_fn=_merge_feedback,
        budget_seconds=stage_budget,
    )

    scoring_task = asyncio.ensure_future(scoring_coro)
    feedback_task = asyncio.ensure_future(feedback_coro)

    scoring_result_raw: Any = None
    feedback_result_raw: Any = None

    done, _pending = await asyncio.wait([scoring_task, feedback_task], return_when=asyncio.FIRST_EXCEPTION)
    for task in done:
        exc = task.exception()
        if exc is not None:
            if task is scoring_task:
                scoring_result_raw = exc
            else:
                feedback_result_raw = exc
        elif task is scoring_task:
            scoring_result_raw = task.result()
        else:
            feedback_result_raw = task.result()

    if not scoring_task.done():
        feedback_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await feedback_task
        scoring_result_raw = await scoring_task
    elif not feedback_task.done():
        if isinstance(scoring_result_raw, BaseException):
            feedback_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await feedback_task
            raise scoring_result_raw
        feedback_result_raw = await feedback_task

    if isinstance(scoring_result_raw, BaseException):
        raise scoring_result_raw

    if isinstance(feedback_result_raw, BaseException):
        log.warning("反馈阶段失败，使用空反馈: %s", feedback_result_raw)
        feedback_result_raw = {}

    scoring_result = scoring_result_raw
    feedback_result = feedback_result_raw

    _tracker_update(scoring_stage, SAVING_PCT, "正在保存评分结果...")
    await _sse_progress(scoring_stage, SAVING_PCT, "正在保存评分结果...")

    result = _postprocess_scoring_result(scoring_result, feedback_result, rubric)
    if result.get("_scoring_fallback"):
        log.warning(
            "scoring_fallback_saved: record_id=%d score=%s feedback_has_content=%s",
            record_id,
            result.get("total_score"),
            bool(feedback_result and any(feedback_result.get(k) for k in ("strengths", "suggestions"))),
        )
    return _persist_score(result, rubric, record_id, db)


def _fallback_scoring(first: dict, second: dict, missing_list: list[str] | None = None) -> dict:
    """Fallback when scoring LLM fails after retry.

    Preserves the partial first-attempt result so the parallel feedback
    result (which may have succeeded) is not discarded by asyncio.gather.
    Phase 1 (S3)：fallback 结构化落库——UI 可见、不进排行榜。
    """
    if first:
        first["_scoring_fallback"] = True
        first["fallback"] = {"kind": "llm_partial"}
        return first
    log.warning("scoring_fallback_zero: both LLM attempts returned empty — saving 0-score")
    return {
        "total_score": 0,
        "detail_scores": {},
        "raw_total": 0,
        "_scoring_fallback": True,
        "fallback": {"kind": "llm_empty"},
    }
