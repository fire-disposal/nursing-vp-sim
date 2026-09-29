"""体验记录导出 —— 一次训练会话的自包含档案（纯函数构造，无 IO）。

平台的职责是「为用户带来一次体验，并记录该次体验」：本模块把散在训练记录、消息、
评分、情绪事件、动作审计里的会话事实装配成**一份可交付的事件流**，研究者据此复盘
与统计，教师与学生据此一起回看这次相遇，都不必依赖应用在线。

边界（不变量）：

* 只**读取既有事实**并如实标出缺口（``gaps``）：不推断、不补默认值、不重算成绩、
  不把缺失值渲染成 0 或"正常"。
* 评分口径（展示分 / 原始分 / 量尺 / 来源 / 降级 / 不完整）全部复用 ``scoring`` 现有
  owner（``grade_policy``、``validation``），导出**不得**产生第二套分数解释。
* 时间是时间线的唯一排序轴；没有时间戳的事件排到末尾并在 ``gaps`` 点名，绝不臆造顺序。
* 纯函数：入参齐备即可复算。取数（DB/文件）属于调用方（``router/session_views.py``）。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any

from core.datetime_utils import ensure_utc, parse_iso_datetime
from core.statuses import normalize_training_mode
from modules.training.manifest import ARTIFACT_DRAFT, ARTIFACT_SUBMITTED, experiment_label
from modules.training.patient_ai.emotion.models import EmotionVector
from modules.training.patient_ai.emotion.renderer import serialize_emotion_vector
from modules.training.scoring.grade_policy import grade_view, score_source
from modules.training.scoring.validation import raw_view_from_display
from modules.training.session.finalize import terminal_reason
from modules.training.workflows import workflow_for_record

SCHEMA = "training-experience-record"
SCHEMA_VERSION = 1

#: 时间线事件类型（``timeline[].kind``）—— 词表固定，消费方按它分流渲染
KIND_MESSAGE = "message"
KIND_EXAM = "exam"
KIND_ARTIFACT = "artifact"
KIND_EMOTION_EVENT = "emotion_event"
KIND_TERMINAL = "terminal"

#: 查体动作的审计 kind（``TrainingAction.kind``）；同名字符串也是 activity id
EXAM_ACTION_KIND = "physical_exam"
ARTIFACT_KIND_NURSING_RECORD = "nursing_record"

#: 缺口码（``gaps[].code``）—— 这份导出**缺什么**由这里点名，而不是留一个难以察觉的空值
GAP_NO_MESSAGES = "no_messages"
GAP_NO_STUDENT_MESSAGES = "no_student_messages"
GAP_SESSION_NOT_FINISHED = "session_not_finished"
GAP_NO_TERMINAL_REASON = "no_terminal_reason"
GAP_NO_EXPERIMENT_BATCH = "no_experiment_batch"
GAP_NO_CASE_REVISION = "no_case_revision"
GAP_NO_EXAM_RESULTS = "no_exam_results"
GAP_EXAM_RESULT_WITHOUT_TIMESTAMP = "exam_result_without_timestamp"
GAP_NO_NURSING_RECORD = "no_nursing_record"
GAP_NURSING_RECORD_NOT_SUBMITTED = "nursing_record_not_submitted"
GAP_NO_EMOTION_EVENTS = "no_emotion_events"
GAP_EMOTION_EVENT_WITHOUT_STATE = "emotion_event_without_state"
GAP_NO_SCORE = "no_score"
GAP_SCORE_ITEMS_UNAVAILABLE = "score_items_unavailable"
GAP_SCORE_ITEMS_RECONSTRUCTED = "score_items_reconstructed"

#: 缺时间戳事件的排序哨兵（必须共享时区，否则与 aware datetime 不可比）
_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


def _get(source: Any, name: str, default: Any = None) -> Any:
    """统一读取 ORM 行与映射（构造器对两者都成立，测试可以用普通 dict）。"""
    if isinstance(source, Mapping):
        return source.get(name, default)
    return getattr(source, name, default)


def _timestamp(value: Any) -> datetime | None:
    """取值 → UTC-aware datetime；缺失或无法解析返回 None（不臆造时刻）。"""
    if value is None:
        return None
    if isinstance(value, datetime):
        return ensure_utc(value)
    try:
        return parse_iso_datetime(str(value))
    except ValueError:
        return None


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _gap(gaps: list[dict[str, Any]], code: str, detail: str, **extra: Any) -> None:
    gaps.append({"code": code, "detail": detail, **extra})


def _event(at: datetime | None, payload: dict[str, Any]) -> tuple[datetime | None, dict[str, Any]]:
    return at, {"at": _iso(at), **payload}


def _sorted_events(events: Sequence[tuple[datetime | None, dict[str, Any]]]) -> list[dict[str, Any]]:
    """按时间排序：有时间戳的升序在前，无时间戳的保持输入顺序排在末尾（稳定）。"""
    ordered = sorted(enumerate(events), key=lambda pair: (pair[1][0] is None, pair[1][0] or _EPOCH, pair[0]))
    return [payload for _, (_, payload) in ordered]


def _comfort(state: Mapping[str, Any]) -> int | None:
    """舒适度（0-100）——与主动追问的 mood 口径同一公式（``patient_ai/initiative.py``）：

    ``comfort = 100 - 0.5*anxiety - 0.5*irritation``（四维皆为 0-100 展示刻度）。
    四维不全时返回 None：宁可缺，不臆造。
    """
    anxiety, irritation = state.get("anxiety"), state.get("irritation")
    if not isinstance(anxiety, (int, float)) or not isinstance(irritation, (int, float)):
        return None
    return round(100 - anxiety * 0.5 - irritation * 0.5)


def _emotion_event_view(event: Any) -> tuple[datetime | None, dict[str, Any]]:
    """情绪事件投影：``after_state`` 按存储形态（0-1 四维）统一序列化为 0-100 + dominant_state。"""
    at = _timestamp(_get(event, "created_at"))
    raw_after = _get(event, "after_state") or {}
    after = (
        serialize_emotion_vector(EmotionVector.from_dict(dict(raw_after)))
        if isinstance(raw_after, Mapping) and raw_after
        else None
    )
    view = {
        "turn_id": _get(event, "turn_id"),
        "event_type": _get(event, "event_type"),
        "confidence": _get(event, "confidence"),
        "evidence": str(_get(event, "evidence") or ""),
        "delta": dict(_get(event, "delta") or {}),
        "after_state": after,
    }
    return _event(at, {**view, "kind": KIND_EMOTION_EVENT})


def _action_exam_data(action: Any) -> dict[str, Any]:
    """审计行的结果载荷：新行为 ``{"data": …, "scene": …}``，旧行为裸 data。"""
    result = _get(action, "result")
    if isinstance(result, Mapping):
        data = result.get("data")
        if isinstance(data, Mapping):
            return dict(data)
        return dict(result)
    return {}


def _exam_events(
    runtime_state: Mapping[str, Any], actions: Sequence[Any]
) -> tuple[list[tuple[datetime | None, dict[str, Any]]], int]:
    """查体动作与结果：以审计行（有时间戳、有 action id）为主，运行态结果为兜底。

    返回 ``(events, untimed_count)``。``runtime_state.exam_results`` 是历史遗留的权威内容
    形态（无时间戳），因此两者按 ``(op_type, value)`` 配对：审计行给出时刻与可链接的
    ``action_id``（评分证据引用 ``kind="action"`` 指的就是它），运行态里没有审计行的条目
    如实带上但时刻为 None，并在 ``gaps`` 点名。
    """
    events: list[tuple[datetime | None, dict[str, Any]]] = []
    seen: list[tuple[str, str]] = []
    for action in actions:
        if _get(action, "kind") != EXAM_ACTION_KIND:
            continue
        data = _action_exam_data(action)
        raw_result = data.get("result")
        result: Mapping[str, Any] = raw_result if isinstance(raw_result, Mapping) else {}
        op_type = str(data.get("op_type") or result.get("op_type") or "")
        value = str(result.get("value", ""))
        raw_interpretation = result.get("interpretation")
        interpretation: Mapping[str, Any] = raw_interpretation if isinstance(raw_interpretation, Mapping) else {}
        events.append(
            _event(
                _timestamp(_get(action, "created_at")),
                {
                    "kind": KIND_EXAM,
                    "source": "action_log",
                    "action_id": _get(action, "id"),
                    "op_type": op_type,
                    "label": str(result.get("label") or ""),
                    "value": value,
                    "unit": str(result.get("unit") or ""),
                    "status": interpretation.get("status"),
                    "interpretation": interpretation.get("text"),
                },
            )
        )
        seen.append((op_type, value))

    untimed = 0
    for entry in (runtime_state or {}).get("exam_results") or []:
        if not isinstance(entry, Mapping):
            continue
        key = (str(entry.get("type") or ""), str(entry.get("value") or ""))
        if key in seen:
            seen.remove(key)
            continue
        untimed += 1
        events.append(
            _event(
                None,
                {
                    "kind": KIND_EXAM,
                    "source": "runtime_state",
                    "action_id": None,
                    "op_type": key[0],
                    "label": str(entry.get("label") or ""),
                    "value": key[1],
                    "unit": str(entry.get("unit") or ""),
                    "status": entry.get("status"),
                    "interpretation": entry.get("interpretation"),
                },
            )
        )
    return events, untimed


def _score_items(raw_detail: Mapping[str, Any]) -> list[dict[str, Any]]:
    """逐项判定：条目原始分 + 状态 + 理由 + 证据引用（定位到真实记录的 id）。"""
    items: list[dict[str, Any]] = []
    for dimension, dim in (raw_detail or {}).items():
        if not isinstance(dim, Mapping):
            continue
        for item in dim.get("items") or []:
            if not isinstance(item, Mapping):
                continue
            score = item.get("score")
            refs = item.get("evidence_refs")
            items.append(
                {
                    "dimension": dimension,
                    "id": str(item.get("id") or ""),
                    "name": str(item.get("name") or ""),
                    "score": float(score) if isinstance(score, (int, float)) else None,
                    "max": item.get("max"),
                    "status": item.get("status"),
                    "reason": item.get("reason"),
                    "evidence": item.get("evidence"),
                    "evidence_refs": [dict(ref) for ref in refs if isinstance(ref, Mapping)]
                    if isinstance(refs, (list, tuple))
                    else [],
                    "evidence_verified": item.get("evidence_verified"),
                }
            )
    return items


def _score_section(score: Any, rubric: Mapping[str, Any] | None, gaps: list[dict[str, Any]]) -> dict[str, Any]:
    """成绩视图：全部口径取自 ``scoring`` 现有 owner，本函数只做投影。"""
    meta = dict(_get(score, "score_meta") or {})
    reviewed_total = _get(score, "reviewed_total")
    fallback = _get(score, "fallback")
    display_total = _get(score, "effective_total")
    raw_max = meta.get("applicable_raw_max")
    raw_scale = rubric.get("raw_scale") if isinstance(rubric, Mapping) else None
    if raw_max is None and isinstance(rubric, Mapping):
        raw_max = rubric.get("raw_max")

    raw_detail = _get(score, "raw_detail_scores")
    items_source = "raw_detail_scores"
    if not isinstance(raw_detail, Mapping) or not raw_detail:
        display_detail = _get(score, "detail_scores")
        if (
            isinstance(display_detail, Mapping)
            and display_detail
            and isinstance(raw_max, (int, float))
            and float(raw_max) > 0
        ):
            # 本批次之前的历史分没有原始层：按展示层反推（分母用当时冻结 rubric 的原始满分）。
            # 反推会丢掉条目状态与证据引用，因此必须显式标记并进 gaps。
            raw_detail = raw_view_from_display(
                dict(display_detail), raw_max=int(raw_max), raw_scale=int(raw_scale or 2)
            )
            items_source = "reconstructed_from_display"
            _gap(
                gaps,
                GAP_SCORE_ITEMS_RECONSTRUCTED,
                "该成绩没有原始逐项层（本批次之前的历史分）：逐项分由展示层反推，"
                "条目状态、证据引用不可得，条目上限可能仍是展示刻度。",
            )
        else:
            raw_detail = {}
            items_source = "unavailable"
            _gap(
                gaps,
                GAP_SCORE_ITEMS_UNAVAILABLE,
                "该成绩没有逐项明细，也无法复原（缺原始逐项层且无当时量尺）。",
            )

    return {
        "display_total": display_total,
        "raw_total": _get(score, "raw_total"),
        "raw_max": raw_max,
        "raw_scale": raw_scale,
        "rubric_version": _get(score, "rubric_version"),
        "mapping_version": _get(score, "mapping_version"),
        "source": score_source(reviewed_total=reviewed_total, fallback=fallback),
        "grade": grade_view(display_total, reviewed_total=reviewed_total, fallback=fallback),
        "reviewed_total": reviewed_total,
        # 降级与不完整必须随成绩出导：研究者据此排除不可用成绩
        "fallback": fallback,
        "incomplete": meta.get("incomplete"),
        "not_applicable_items": list(meta.get("not_applicable_items") or []),
        "items_source": items_source,
        "items": _score_items(raw_detail),
        "feedback": {
            "strengths": list(_get(score, "strengths") or []),
            "weaknesses": list(_get(score, "weaknesses") or []),
            "missed_content": list(_get(score, "missed_content") or []),
            "suggestions": str(_get(score, "suggestions") or ""),
            # 空反馈的理由（为什么"没有明确不足"），缺失即 null
            "note": meta.get("feedback_note"),
        },
        "model_name": _get(score, "model_name"),
        "scored_at": _iso(_timestamp(_get(score, "created_at"))),
    }


def _session_section(
    record: Any,
    workflow: Any,
    *,
    case_name: str,
    case_revision_no: int | None,
    start_time: datetime | None,
    end_time: datetime | None,
    practice_snapshot: Mapping[str, Any],
    case_data: Mapping[str, Any],
    gaps: list[dict[str, Any]],
) -> dict[str, Any]:
    """会话身份：这是**哪一次**体验（谁、哪一版病例、哪种模式、哪一批实验）。"""
    experiment = practice_snapshot.get("experiment")
    experiment = dict(experiment) if isinstance(experiment, Mapping) else None
    case_revision_id = _get(record, "case_revision_id")
    if not case_revision_id:
        _gap(gaps, GAP_NO_CASE_REVISION, "该记录未钉住病例修订版本（旧记录）：病例内容只在冻结快照里。")
    if experiment is None:
        _gap(gaps, GAP_NO_EXPERIMENT_BATCH, "该记录未标记实验批次（非实验训练不写该标签，不是缺失数据）。")
    if end_time is None:
        _gap(gaps, GAP_SESSION_NOT_FINISHED, "训练尚未结束（无结束时间）：时长与终局原因均为 null。")
    duration = (
        int((end_time - start_time).total_seconds()) if start_time and end_time and end_time >= start_time else None
    )
    user = _get(record, "user")
    return {
        "record_id": _get(record, "id"),
        "workflow": {"id": workflow.id, "label": workflow.label},
        "case": {
            "case_id": _get(record, "case_id"),
            "name": case_name or str(case_data.get("title") or ""),
            "case_revision_id": case_revision_id,
            "revision_no": case_revision_no,
        },
        "mode": normalize_training_mode((practice_snapshot.get("behavior") or {}).get("mode")),
        "status": _get(record, "status"),
        "scoring_status": _get(record, "scoring_status"),
        "start_time": _iso(start_time),
        "end_time": _iso(end_time),
        "duration_seconds": duration,
        "time_limit_minutes": _get(record, "time_limit"),
        "is_student_practice": bool(_get(record, "is_student_practice")),
        "experiment": experiment,
        "experiment_label": experiment_label(practice_snapshot) or None,
        "user": {
            "id": _get(record, "user_id"),
            "display_name": _get(user, "display_name") if user else None,
            "student_id": _get(user, "student_id") if user else None,
        },
    }


def _message_events(
    messages: Sequence[Any], gaps: list[dict[str, Any]]
) -> list[tuple[datetime | None, dict[str, Any]]]:
    """学生/患者消息——问诊过程本身（带 message_id，可与评分证据引用对齐）。"""
    events = [
        _event(
            _timestamp(_get(message, "created_at")),
            {
                "kind": KIND_MESSAGE,
                "message_id": _get(message, "id"),
                "role": str(_get(message, "role") or ""),
                "content": str(_get(message, "content") or ""),
            },
        )
        for message in messages or []
    ]
    if not events:
        _gap(gaps, GAP_NO_MESSAGES, "本次训练没有任何对话消息。")
    elif not any(payload.get("role") == "student" for _, payload in events):
        _gap(gaps, GAP_NO_STUDENT_MESSAGES, "本次训练没有学生发言（没有问诊内容）。")
    return events


def _exam_section(
    runtime_state: Mapping[str, Any], actions: Sequence[Any], gaps: list[dict[str, Any]]
) -> list[tuple[datetime | None, dict[str, Any]]]:
    events, untimed = _exam_events(runtime_state, actions)
    if not events:
        _gap(gaps, GAP_NO_EXAM_RESULTS, "本次训练没有查体动作与结果。")
    if untimed:
        _gap(
            gaps,
            GAP_EXAM_RESULT_WITHOUT_TIMESTAMP,
            f"{untimed} 条查体结果在动作审计里没有对应行，时刻不可知，已排在时间线末尾。",
            count=untimed,
        )
    return events


def _artifact_events(
    nursing_record: Any | None, *, required: bool, gaps: list[dict[str, Any]]
) -> list[tuple[datetime | None, dict[str, Any]]]:
    """护理评估产物状态（draft/submitted）—— 产物状态的真值在 ``nursing_records`` 行上。"""
    if nursing_record is None:
        _gap(gaps, GAP_NO_NURSING_RECORD, "本次训练没有护理评估产物。", required=required)
        return []
    submitted_at = _timestamp(_get(nursing_record, "submitted_at"))
    updated_at = _timestamp(_get(nursing_record, "updated_at"))
    if not submitted_at:
        _gap(gaps, GAP_NURSING_RECORD_NOT_SUBMITTED, "护理评估只有草稿，未提交。")
    return [
        _event(
            submitted_at or updated_at,
            {
                "kind": KIND_ARTIFACT,
                "artifact_kind": ARTIFACT_KIND_NURSING_RECORD,
                "state": ARTIFACT_SUBMITTED if submitted_at else ARTIFACT_DRAFT,
                "required": required,
                "submitted_at": _iso(submitted_at),
                "updated_at": _iso(updated_at),
            },
        )
    ]


def _terminal_event(
    record: Any, end_time: datetime | None, gaps: list[dict[str, Any]]
) -> tuple[datetime | None, dict[str, Any]]:
    """系统终局：训练为什么结束（用户主动 / 超时 / 患者中止）。"""
    reason = terminal_reason(record)
    if end_time is not None and reason is None:
        _gap(gaps, GAP_NO_TERMINAL_REASON, "训练已结束但没记录终局原因（旧记录）。")
    return _event(end_time, {"kind": KIND_TERMINAL, "status": str(_get(record, "status") or ""), "reason": reason})


def _affect_section(
    emotion_pairs: Sequence[tuple[datetime | None, dict[str, Any]]], gaps: list[dict[str, Any]]
) -> dict[str, Any]:
    """情绪轨迹：事件序列 + 最终四维（从事件里推，缺就 null 并在 gaps 点名）。"""
    if not emotion_pairs:
        _gap(gaps, GAP_NO_EMOTION_EVENTS, "本次训练没有情绪事件（患者情绪轨迹不可得）。")
    elif any(payload["after_state"] is None for _, payload in emotion_pairs):
        _gap(gaps, GAP_EMOTION_EVENT_WITHOUT_STATE, "有情绪事件缺少四维快照，最终状态据此推不出来。")
    final_state = next(
        (payload["after_state"] for _, payload in reversed(emotion_pairs) if payload["after_state"]), None
    )
    comfort = _comfort(final_state) if final_state else None
    return {
        "event_count": len(emotion_pairs),
        "events": [payload for _, payload in emotion_pairs],
        "final": ({**final_state, "comfort": comfort} if final_state else None),
        # 舒适度是派生值（平台暴露给患者的 mood 口径），标出来源，避免与四维观测混为一谈
        "comfort_source": "initiative_mood" if comfort is not None else None,
    }


def build_experience_record(
    record: Any,
    messages: Sequence[Any],
    score: Any | None,
    emotion_events: Sequence[Any],
    actions: Sequence[Any],
    *,
    case_name: str = "",
    case_revision_no: int | None = None,
    nursing_record: Any | None = None,
    rubric: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """装配一份体验记录（纯函数，无 IO）。

    Args:
        record: 训练记录行（读 ``practice_snapshot`` / ``runtime_state`` / ``case_snapshot`` 等列）
        messages: 该记录的消息（构造器会按时间重排）
        score: 成绩行或 None（None 即无成绩，**不伪造**分数）
        emotion_events: 情绪事件行（``after_state`` 为存储形态的 0-1 四维）
        actions: 动作审计行（查体时刻与 result 的唯一来源）
        case_name: 病例展示名（隐藏病例身份时的占位文案由调用方按同一规则解析）
        case_revision_no: 记录钉住的病例内容修订号（旧记录在库里就没有 → None）
        nursing_record: 护理评估产物行或 None
        rubric: 该记录冻结的评分标准（重建历史分原始量尺用，可选）

    Returns:
        ``{schema, schema_version, session, timeline, affect, score, gaps}``；缺失事实一律
        为 null 且在 ``gaps`` 点名。
    """
    gaps: list[dict[str, Any]] = []
    runtime_state = dict(_get(record, "runtime_state") or {})
    practice_snapshot = dict(_get(record, "practice_snapshot") or {})
    case_data = dict(_get(record, "case_snapshot") or {})
    workflow = workflow_for_record(record)
    start_time = _timestamp(_get(record, "start_time"))
    end_time = _timestamp(_get(record, "end_time"))

    session = _session_section(
        record,
        workflow,
        case_name=case_name,
        case_revision_no=case_revision_no,
        start_time=start_time,
        end_time=end_time,
        practice_snapshot=practice_snapshot,
        case_data=case_data,
        gaps=gaps,
    )
    emotion_pairs = [_emotion_event_view(event) for event in emotion_events or []]
    events: list[tuple[datetime | None, dict[str, Any]]] = [
        *_message_events(messages, gaps),
        *_exam_section(runtime_state, actions, gaps),
        *_artifact_events(
            nursing_record,
            required=ARTIFACT_KIND_NURSING_RECORD in workflow.required_artifacts_for(case_data),
            gaps=gaps,
        ),
        *emotion_pairs,
        _terminal_event(record, end_time, gaps),
    ]
    score_section = _score_section(score, rubric, gaps) if score is not None else None
    if score_section is None:
        _gap(
            gaps,
            GAP_NO_SCORE,
            "本次训练没有成绩：不提供任何分数（scoring_status 见 session）。",
            scoring_status=_get(record, "scoring_status"),
            scoring_error=_get(record, "scoring_error"),
        )

    return {
        "schema": SCHEMA,
        "schema_version": SCHEMA_VERSION,
        "session": session,
        "timeline": _sorted_events(events),
        "affect": _affect_section(emotion_pairs, gaps),
        "score": score_section,
        "gaps": gaps,
    }
