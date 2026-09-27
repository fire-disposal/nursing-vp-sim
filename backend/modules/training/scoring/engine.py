import asyncio
import contextlib
import json
import logging
import time
from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from core.exceptions import LLMParseError
from core.statuses import ScoringStatus, normalize_training_mode
from core.template import render_template
from infra.llm import safe_parse_json
from infra.llm.client import CallContext, LLMClient
from infra.llm.parsing import TruncatedJSONError
from infra.llm.profile import get_enable_thinking, get_llm_config
from models import Message, NursingRecord, Score, TrainingAction, TrainingRecord
from modules.training.blueprint import not_applicable_item_ids, scoring_task_boundary_text
from modules.training.prompt_identity import compute_prompt_id
from modules.training.prompts.scoring import (
    FEEDBACK_RETRY_TRUNCATED_USER,
    FEEDBACK_RETRY_USER,
    SCORING_FEEDBACK_SYSTEM,
    SCORING_FEEDBACK_USER,
    SCORING_RETRY_TRUNCATED_USER,
    SCORING_RETRY_USER,
    SCORING_SYSTEM,
    SCORING_USER,
)
from modules.training.scoring.rubric_loader import get_rubric_version_id, rubric_content_id
from modules.training.tools.nursing_record import FIELD_KEYS as NURSING_RECORD_FIELDS
from modules.training.workflows import record_activity_available, workflow_for_record

from .evidence import resolve_evidence_refs
from .grade_policy import GRADE_POLICY_ID, GRADE_POLICY_VERSION
from .mapping import LEGACY_VERSION, MAPPING_VERSION
from .prompt_builder import build_scoring_criteria, build_scoring_json_schema
from .validation import (
    _apply_item_status,
    _backfill_missing_items,
    _clamp_scores,
    _coerce_numeric_fields,
    _convert_to_100_scale,
    _filter_hallucinated_dimensions,
    _filter_hallucinated_items,
    _inject_missing_dimensions,
    _inject_rubric_max,
    _merge_feedback,
    _missing_feedback_fields,
    _normalize_feedback_fields,
    _recalc_dim_max,
    _recalc_total_from_dimensions,
    _validate_feedback_fields,
    _validate_items_content,
    _validate_scoring_essentials,
    _validate_scoring_result,
    applicable_raw_max,
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
# 评分输入消息上界（内测期体验优先：保留充足上下文，仅在极端超长对话时兜底）
SCORING_MAX_MESSAGES = 400
# 护理诊断注入条数上界（防止异常数据把评分提示词撑爆）
_NURSING_DIAGNOSIS_MAX = 8

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
) -> tuple[dict, bool]:
    """Stream LLM response.  Pushes *thinking* tokens to SSE, never content chunks.

    返回 ``(结果, 是否截断)``：截断是**可重试**的失败（压缩输出再试），不是"模型返回空"。
    """
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
    finish_reason = ""

    async def _on_finish(reason: str) -> None:
        nonlocal finish_reason
        finish_reason = reason

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
        async for chunk in llm_client.stream(
            messages, on_reasoning=_on_reasoning, on_finish=_on_finish, **stream_kwargs
        ):
            content_parts.append(chunk)

        full_text = "".join(content_parts)
        result = safe_parse_json(full_text)
        _coerce_numeric_fields(result)
        return result, False
    except TruncatedJSONError as e:
        # 截断与"不是 JSON"必须分开：截断要**压缩输出后重试**，不能被当成"模型返回空"
        # （2026-09-27 真实故障：只缺最外层一个 } 被误判为空 → 落 0 分）
        log.warning(
            "Stream attempt truncated: record_id=%d purpose=%s len=%d finish_reason=%r tail=%r",
            stage.record_id,
            purpose,
            len(full_text),
            finish_reason or "(未上报)",
            full_text[-200:],
        )
        log.debug("truncation detail: %s", str(e)[:200])
        return {}, True
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
        return {}, False
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
    retry_prompt_truncated_template: str | None = None,
    fallback_fn=None,
    budget_seconds: float,
    not_applicable: frozenset[str] = frozenset(),
) -> dict:
    """Single scoring stage with retry.  Per-stage timeout = min(150s, 剩余预算)。

    S8：全局超时（SCORING_TIMEOUT_SECONDS）约束整次评分（两阶段并行共享）；
    单阶段（首试+重试）预算 = 全局 - 余量。重试超时优先走 fallback，
    不再出现"重试必然被全局超时杀死"的矛盾。
    """
    _tracker_update(stage, stage.pct_base, f"正在{stage.progress_msg}...")
    deadline = time.monotonic() + budget_seconds

    async def _try_once(msgs: list[dict]) -> tuple[dict, bool]:
        remaining = max(15.0, deadline - time.monotonic())
        timeout = min(PER_STAGE_TIMEOUT_SEC, remaining)
        return await asyncio.wait_for(
            _stream_attempt(
                llm_client, msgs, llm_cfg, stage=stage, purpose=purpose, case_id=case_id, log_meta=log_meta
            ),
            timeout=timeout,
        )

    result, truncated = await _try_once(messages)

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
        _validate_items_content(result.get("detail_scores", {}), not_applicable)
        if result
        else ["LLM 流式响应解析失败，未获得任何 JSON 数据"]
    )
    validation_msg = "; ".join(item_errors) if item_errors else "字段缺失或不完整"

    # 只有**缺失或类型非法**的反馈字段才触发补全；空数组是合法结果（不再凑反馈）。
    missing_list = _missing_feedback_fields(result) if result else ["所有字段"]
    if not missing_list:
        missing_list = ["strengths", "weaknesses", "missed_content", "suggestions"]
    missing = ", ".join(missing_list)

    retry_user = render_template(
        retry_prompt_truncated_template if (truncated and retry_prompt_truncated_template) else retry_prompt_template,
        partial_json=partial_json or "(上轮响应为空，需要重新生成完整 JSON)",
        validation_errors=validation_msg,
        missing=missing,
    )
    retry_msgs = [*messages]
    if partial_json:
        retry_msgs.append({"role": "assistant", "content": partial_json})
    retry_msgs.append({"role": "user", "content": retry_user})

    try:
        result2, _ = await _try_once(retry_msgs)
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
        # 存量记录没有 rubric 快照：按**记录冻结的 workflow** 重建（不是按代码常量）
        base_rubric = workflow_for_record(record).rubric
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


def _prepare_scoring_texts(rubric: dict, case_data: dict) -> tuple[str, str, str, str, str]:
    all_required = case_data.get("required_inquiries", [])
    scoring_criteria_text = build_scoring_criteria(rubric)
    scoring_criteria_text_brief = build_scoring_criteria(rubric, level="brief")
    scoring_json_schema_text = build_scoring_json_schema(rubric, stage="scoring")
    required_inquiries_text = json.dumps(all_required, ensure_ascii=False, indent=2)
    # 任务边界（docs/19 §4.2「目标适配」）：病例没声明蓝图时给出明确口径，而不是留空
    # 让模型自行猜测有哪些条目适用。
    task_boundary_text = scoring_task_boundary_text(case_data) or (
        "本次任务未声明教学蓝图：按评分标准逐项判定，不额外假设适用性；"
        "学生没有实施干预并观察效果的机会时，评价其护理计划与效果评价方法。"
    )
    return (
        scoring_criteria_text,
        scoring_criteria_text_brief,
        scoring_json_schema_text,
        required_inquiries_text,
        task_boundary_text,
    )


def _format_nursing_diagnoses(record: TrainingRecord) -> str:
    """结构化护理诊断（nursing_diagnosis 工具产物）→ 评分文本证据。

    形态由前端工具面决定：``{problem, related_factors[], defining_characteristics[], priority}``，
    数组顺序即优先级。
    """
    diagnoses = (getattr(record, "runtime_state", None) or {}).get("nursing_diagnoses") or []
    if not isinstance(diagnoses, list):
        return ""
    lines: list[str] = []
    for idx, item in enumerate(diagnoses[:_NURSING_DIAGNOSIS_MAX], start=1):
        if not isinstance(item, dict):
            continue
        problem = str(item.get("problem") or "").strip()
        if not problem:
            continue
        factors = [str(f) for f in (item.get("related_factors") or []) if str(f).strip()]
        characteristics = [str(c) for c in (item.get("defining_characteristics") or []) if str(c).strip()]
        lines.append(
            f"{idx}. {problem}｜相关因素：{'、'.join(factors) or '未填写'}"
            f"｜定义特征：{'、'.join(characteristics) or '未填写'}"
        )
    return "\n".join(lines)


def _load_nursing_record_text(db: Session, record: TrainingRecord) -> str:
    """护理评估评分注入：**只读已提交（冻结）的版本** —— 未提交草稿一律不进评分证据。

    提交状态只看 ``NursingRecord.submitted_at``：``finalize`` 不再把草稿自动标为
    submitted，因此「零评估也能完成训练」在数据层面被堵死（未提交 → 该维度无证据）。

    同时并入结构化护理诊断（``nursing_diagnosis`` 工具产物，按优先级排序）：
    它是记录的一部分，且训练结束后工具面已被生命周期挡住，内容同样冻结。
    """
    record_enabled = record_activity_available(record, "nursing_record")
    diagnoses_enabled = record_activity_available(record, "nursing_diagnosis")
    if not (record_enabled or diagnoses_enabled):
        return ""

    text = ""
    if record_enabled:
        nr = db.query(NursingRecord).filter(NursingRecord.record_id == record.id).first()
        # 未提交（submitted_at 为空）→ 不是冻结版本，不得进入正式评分输入
        if nr is not None and nr.submitted_at is not None:
            sheet = nr.sheet_data or {}
            parts = []
            for field_name in NURSING_RECORD_FIELDS:
                val = sheet.get(field_name, "")
                if val:
                    parts.append(f"{field_name.upper()}: {val}")
            text = "\n\n".join(parts)

    diagnoses_text = _format_nursing_diagnoses(record) if diagnoses_enabled else ""
    if diagnoses_text:
        section = f"护理诊断（结构化，按优先级排序）：\n{diagnoses_text}"
        text = f"{text}\n\n{section}" if text else section
    return text


def _build_history_messages(
    db: Session,
    record: TrainingRecord,
    scoring_criteria_text: str,
    required_inquiries_text: str,
    scoring_json_schema_text: str,
    conversation_text: str,
    nursing_record_text: str = "",
    task_boundary_text: str = "",
) -> tuple[list[dict], str, str, list[TrainingAction]]:
    """装配评分阶段消息。

    已记录动作（查体）与已提交产物（护理评估）都是评分证据的一部分，直接作为模板变量
    送达模型，并在返回值里带出查体动作行，供证据引用定位（``scoring/evidence.py``）
    复用同一次查询。
    """
    # Prefer TrainingAction audit timeline; fall back to legacy runtime_state
    actions = (
        db.query(TrainingAction)
        .filter(TrainingAction.record_id == record.id, TrainingAction.kind == "physical_exam")
        .order_by(TrainingAction.created_at)
        .all()
    )
    if actions:
        # 工具动作结果两种形态：{"data": ..., "scene": ...}（新）与裸 data（旧）。
        # 只取 data，避免 scene 补丁污染评分提示词。
        exam_results_raw = [a.result.get("data", a.result) if isinstance(a.result, dict) else a.result for a in actions]
    else:
        exam_results_raw = (record.runtime_state or {}).get("exam_results", [])
        if exam_results_raw:
            log.info("Scoring using legacy runtime_state exam_results: record_id=%d", record.id)
    exam_results_text = (
        json.dumps(exam_results_raw, ensure_ascii=False, indent=2) if exam_results_raw else "学生未执行任何查体操作"
    )

    prompt_kw = {
        "scoring_criteria": scoring_criteria_text,
        "required_inquiries": required_inquiries_text,
        "scoring_json_schema": scoring_json_schema_text,
        "conversation_text": conversation_text,
        "exam_results": exam_results_text,
        "nursing_record": nursing_record_text or "学生未提交护理评估记录",
        "task_boundary": task_boundary_text,
    }
    score_system = render_template(SCORING_SYSTEM, **prompt_kw)
    score_user = render_template(SCORING_USER, **prompt_kw)
    score_messages = [
        {"role": "system", "content": score_system},
        {"role": "user", "content": score_user},
    ]
    return score_messages, exam_results_text, nursing_record_text, list(actions)


def _build_feedback_messages(
    scoring_criteria_text_brief: str,
    required_inquiries_text: str,
    conversation_text: str,
    exam_results_text: str,
    nursing_record_text: str,
    task_boundary_text: str = "",
) -> list[dict]:
    fb_kw = {
        "scoring_criteria": scoring_criteria_text_brief,
        "required_inquiries": required_inquiries_text,
        "conversation_text": conversation_text,
        "exam_results": exam_results_text,
        "nursing_record": nursing_record_text or "学生未提交护理评估记录",
        "task_boundary": task_boundary_text,
    }
    feedback_system = render_template(SCORING_FEEDBACK_SYSTEM, **fb_kw)
    feedback_user = render_template(SCORING_FEEDBACK_USER, **fb_kw)
    return [
        {"role": "system", "content": feedback_system},
        {"role": "user", "content": feedback_user},
    ]


def _attach_evidence_refs(
    scoring_result: dict,
    *,
    messages: list[Message],
    action_rows: list[TrainingAction],
    nursing_record_text: str,
) -> None:
    """把每个条目的证据引用定位到真实记录（就地修改，确定性匹配）。"""
    detail = scoring_result.get("detail_scores")
    if not isinstance(detail, dict) or not detail:
        return
    msg_rows = [(m.id, m.role, m.content or "") for m in messages]
    action_texts = []
    for action in action_rows:
        payload = action.result if isinstance(action.result, dict) else {}
        text = json.dumps(payload.get("data", payload), ensure_ascii=False)
        action_texts.append((action.id, action.kind, text))
    artifacts = [("nursing_record", nursing_record_text)] if nursing_record_text else []

    unverified = 0
    for dim_data in detail.values():
        if not isinstance(dim_data, dict):
            continue
        for item in dim_data.get("items", []) or []:
            if not isinstance(item, dict):
                continue
            evidence = str(item.get("evidence") or "").strip()
            refs, verified = resolve_evidence_refs(
                evidence,
                messages=msg_rows,
                actions=action_texts,
                artifacts=artifacts,
            )
            item["evidence_refs"] = refs
            item["evidence_verified"] = verified
            if evidence and not verified:
                unverified += 1
    if unverified:
        log.info(
            "scoring_evidence_unverified",
            extra={"record_id": scoring_result.get("_record_id"), "items": unverified},
        )


_FEEDBACK_DEFAULTS = {
    "strengths": [],
    "weaknesses": [],
    "missed_content": [],
    "suggestions": "",
}


def _postprocess_scoring_result(
    scoring_result: dict,
    feedback_result: dict,
    rubric: dict,
    *,
    not_applicable: frozenset[str] = frozenset(),
    feedback_note: str = "",
) -> dict:
    result = {**scoring_result}
    for field in ("strengths", "weaknesses", "missed_content", "suggestions"):
        val = feedback_result.get(field)
        if val is not None:
            result[field] = val
        else:
            result.setdefault(field, _FEEDBACK_DEFAULTS[field])
    # 空反馈必须有语义（docs/19 §4.2 第 5 条）：解释为什么没有不足/漏问，随评分落库。
    if feedback_note:
        result["feedback_note"] = str(feedback_note)[:500]

    # S3: 全空兜底（LLM 双次失败）——跳过注入/换算，保留 0 分 + llm_empty 标记
    if result.get("fallback", {}).get("kind") == "llm_empty":
        result["raw_total"] = 0
        result["dim_total"] = {}
        result["raw_detail_scores"] = {}
        result["applicable_raw_max"] = 0
        result["not_applicable_items"] = []
        return result

    _inject_rubric_max(result, rubric)
    _coerce_numeric_fields(result)

    rubric_dim_names = {d["name"] for d in rubric.get("dimensions", [])}
    result["detail_scores"] = _filter_hallucinated_dimensions(result.get("detail_scores", {}), rubric_dim_names)
    raw_scale = rubric.get("raw_scale", 3)
    # 条目集合以**冻结 rubric** 为准：先剔除非 rubric 条目（会凭空抬分母），再补齐漏答条目。
    _filter_hallucinated_items(result.get("detail_scores", {}), rubric)
    _clamp_scores(result.get("detail_scores", {}), raw_scale=raw_scale)
    injected_dims = _inject_missing_dimensions(result.get("detail_scores", {}), rubric, not_applicable)
    backfilled_items = _backfill_missing_items(result.get("detail_scores", {}), rubric, not_applicable)

    # 适用性（唯一判定处）：病例声明不适用的条目 score=None 且不计入分母；未声明不适用
    # 却没有分数的条目是模型/系统问题，必须显式标记，不能当学生得 0 分。
    declared_na, unscored_items = _apply_item_status(result.get("detail_scores", {}), not_applicable)
    unscored_items = sorted({*unscored_items, *backfilled_items})
    _recalc_dim_max(result.get("detail_scores", {}), raw_scale)

    # 部分条目没被判定 = 结果**不完整**，不是"评分不可用"：
    # 早年写法把这种情况打成 fallback（=整条记录退出统计），模型偶尔漏一条就让学生失去成绩 ——
    # 既不合比例，也不可行。这里改为随记录携带一份"哪些没判"的清单，成绩照常计，
    # 界面如实说明，学生不被误当成 0 分、也不被摘出统计。真正不可用（解析失败/全维度缺失）
    # 仍走 fallback 通道。
    if unscored_items or injected_dims:
        result["incomplete"] = {
            "unscored_items": unscored_items,
            "dims": injected_dims,
            "count": len(unscored_items),
        }
        log.info(
            "scoring_incomplete: unscored=%d dims=%s",
            len(unscored_items),
            injected_dims,
            extra={"record_id": result.get("_record_id")},
        )

    # S2: 总分 = Σ条目分（原始刻度），dim_total 为原始维度快照（展示用）
    raw_total = _recalc_total_from_dimensions(result.get("detail_scores", {}), raw_scale)
    applicable = applicable_raw_max(result.get("detail_scores", {}), raw_scale)
    result["raw_total"] = raw_total
    result["applicable_raw_max"] = applicable
    result["not_applicable_items"] = sorted(declared_na)
    # 原始精度快照：展示换算只作用于 detail_scores（投影层），原始条目单独保留。
    result["raw_detail_scores"] = deepcopy(result.get("detail_scores", {}))
    result["dim_total"] = {
        name: {"score": d.get("score"), "max": d.get("max")}
        for name, d in result.get("detail_scores", {}).items()
        if isinstance(d, dict)
    }

    if applicable <= 0:
        # 全部条目都被声明不适用：没有可评内容，标为降级而不是"学生得 0 分"。
        result["_scoring_fallback"] = True
        result.setdefault("fallback", {"kind": "no_applicable_items"})
        log.warning("scoring_no_applicable_items", extra={"record_id": result.get("_record_id")})

    if result.get("_scoring_fallback"):
        # S3：兜底输出不做"总分 = Σ条目分"校正——保留 LLM 自评分作为证据。
        # 但 LLM 自评分缺失/非法时无法落库，退化到 Σ条目分（S2 不变量），
        # 而不是用一个凭空的 0 冒充"该生得 0 分"。
        if not isinstance(result.get("total_score"), (int, float)):
            log.warning("scoring_fallback_total_from_items", extra={"raw_total": raw_total})
            result["total_score"] = raw_total
        else:
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
                extra={"llm_total": original_total, "recalc_total": raw_total},
            )
            result["total_score"] = raw_total

    # S4b: 全维度注入 = 没有任何可用 LLM 评分 → 显式 fallback 标记（先标记，再决定是否终局校验）
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

    if result.get("_scoring_fallback"):
        # S3 契约：兜底结果本身即"已知不完整"，必须落库可见而不是被判死。
        # 终局校验降级为字段归一化（不抛异常），否则故障从"带标记的兜底分"退化成"无分 failed"。
        missing_feedback = _normalize_feedback_fields(result)
        log.warning(
            "scoring_fallback_bypass_final_validation",
            extra={"missing_feedback": missing_feedback, "fallback": result.get("fallback")},
        )
    else:
        _validate_scoring_result(result, rubric, not_applicable)

    # 展示投影：分母 = 适用原始满分（不适用条目已排除）；无适用条目时不换算（保持 0）。
    if applicable > 0:
        _convert_to_100_scale(result, applicable)
    else:
        result["total_score"] = 0
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
    practice = (record.practice_snapshot or {}) if record else {}
    # 评分溯源（docs/19 §4.4）：新记录关联评分提示词内容身份、rubric 内容身份、适用分母、
    # 等第政策身份与辅助条件。身份都是**派生值**，这里物化进评分行的元数据快照，供事后研究
    # 区分「同一 rubric_version 下的不同量尺」；历史行没有该列 → 明确为身份不明。
    score_meta = {
        "applicable_raw_max": result.get("applicable_raw_max"),
        "not_applicable_items": result.get("not_applicable_items") or [],
        "rubric_content_id": rubric_content_id(rubric),
        "scoring_prompt_id": compute_prompt_id("history_taking.scoring", SCORING_SYSTEM, SCORING_USER),
        "feedback_prompt_id": compute_prompt_id(
            "history_taking.scoring_feedback", SCORING_FEEDBACK_SYSTEM, SCORING_FEEDBACK_USER
        ),
        "grade_policy": {"id": GRADE_POLICY_ID, "version": GRADE_POLICY_VERSION},
        "assistance": {"mode": normalize_training_mode((practice.get("behavior") or {}).get("mode"))},
    }
    # 实验批次随成绩走：多批次实验要能按批分组比较（未标记时不写该键）
    if practice.get("experiment"):
        score_meta["experiment"] = practice["experiment"]
    if result.get("feedback_note"):
        score_meta["feedback_note"] = result["feedback_note"]
    if result.get("incomplete"):
        # 不完整清单（哪些条目没被判）：成绩照常进统计，界面据此如实说明
        score_meta["incomplete"] = result["incomplete"]
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
        prompt_schema_version=snapshot.schema_version if snapshot else 1,
        # Phase 1 契约：raw_total/fallback/dim_total 落库（S2/S3/S4）
        raw_total=result.get("raw_total"),
        mapping_version=MAPPING_VERSION if result.get("raw_total") is not None else LEGACY_VERSION,
        fallback=result.get("fallback"),
        dim_total=result.get("dim_total"),
        # 本批次契约：原始逐项精度与溯源元数据（历史行为 NULL = 不可比，不回填）
        raw_detail_scores=result.get("raw_detail_scores"),
        score_meta=score_meta,
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

    # 适用性与任务边界取自**记录冻结的病例内容**（快照优先），与评分输入同源。
    frozen_case_data = record.case_snapshot or case_data
    not_applicable = not_applicable_item_ids(frozen_case_data)

    (
        scoring_criteria_text,
        scoring_criteria_text_brief,
        scoring_json_schema_text,
        required_inquiries_text,
        task_boundary_text,
    ) = _prepare_scoring_texts(rubric, frozen_case_data)
    nursing_record_text = _load_nursing_record_text(db, record)
    score_messages, exam_results_text, nursing_record_text, exam_action_rows = _build_history_messages(
        db,
        record,
        scoring_criteria_text,
        required_inquiries_text,
        scoring_json_schema_text,
        conversation_text,
        nursing_record_text,
        task_boundary_text,
    )

    feedback_messages = _build_feedback_messages(
        scoring_criteria_text_brief,
        required_inquiries_text,
        conversation_text,
        exam_results_text,
        nursing_record_text,
        task_boundary_text,
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
        retry_prompt_truncated_template=SCORING_RETRY_TRUNCATED_USER,
        fallback_fn=_fallback_scoring,
        budget_seconds=stage_budget,
        not_applicable=not_applicable,
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
        retry_prompt_truncated_template=FEEDBACK_RETRY_TRUNCATED_USER,
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

    # 证据引用定位（确定性，无第二次 LLM 调用）：把模型引用到的原话映射到真实记录 id。
    _attach_evidence_refs(
        scoring_result,
        messages=messages,
        action_rows=exam_action_rows,
        nursing_record_text=nursing_record_text,
    )
    feedback_note = str(feedback_result.get("explained_empty") or "") if isinstance(feedback_result, dict) else ""
    result = _postprocess_scoring_result(
        scoring_result,
        feedback_result,
        rubric,
        not_applicable=not_applicable,
        feedback_note=feedback_note,
    )
    if result.get("_scoring_fallback"):
        log.warning(
            "scoring_fallback_saved: record_id=%d score=%s feedback_has_content=%s",
            record_id,
            result.get("total_score"),
            bool(feedback_result and any(feedback_result.get(k) for k in ("strengths", "suggestions"))),
        )
    return _persist_score(result, rubric, record_id, db)


class ScoringUnavailableError(RuntimeError):
    """两次尝试都没有可用评分（无 detail_scores）。

    不落"假 0 分"：0 分是对学生的**错误陈述**（"你什么都没做到"），而降级标记不足以抵消它。
    正确做法是标记评分失败并允许重试 —— 执行器据此把 ``scoring_status`` 置为 ``failed``
    并写 ``scoring_error``，前端展示失败态 + 重试入口（2026-09-27 真实故障的修复）。
    """


def _fallback_scoring(first: dict, second: dict, missing_list: list[str] | None = None) -> dict:
    """Fallback when scoring LLM fails after retry.

    Preserves the partial first-attempt result so the parallel feedback
    result (which may have succeeded) is not discarded by asyncio.gather.
    Phase 1 (S3)：fallback 结构化落库——UI 可见、不进排行榜。
    """
    if first:
        # 首试是"半坏"结果（有 detail_scores 但缺 total_score/类型错）：
        # 兜底标记保证它能落库；total_score 缺失时由 _postprocess_scoring_result
        # 退化到 Σ条目分（S2），此处不写一个凭空的 0。
        first["_scoring_fallback"] = True
        first["fallback"] = {"kind": "llm_partial"}
        return first
    log.warning("scoring_unavailable: both LLM attempts returned nothing usable — marking failed (no fake 0)")
    raise ScoringUnavailableError("两次尝试均未获得可用评分（无 detail_scores）：标记失败以便重试，不落 0 分")
