"""临床判断训练（V2）的患者回合 —— 独立 LLM 核心。

**不复用** ``history_taking`` 的五阶段 pipeline：那条链是"问诊评分"的闭包（情绪、
主动追问、护理记录注入、问诊评分提示词）。这里只做这件事：

1. 从**病例事实**装配患者视角的提示词（人物经历、可说事实、对话历史、
   已发生的现场状态；绝不含 rubric/权重/未观察证据的临床解释）；
2. 一次 ``call_json``（purpose = ``clinical_reasoning_turn``，配置由 profile 提供）；
3. **过滤**模型输出：证据与沟通标记必须携带对应原文的逐字引用；只接受
   ``initial.hidden_findings`` 里 ``obtainable_via`` 含 ``inquiry`` 的 finding、
   只接受已存在目标。自然说出的内容如实记录，不用数量上限制造文本与状态分裂；
4. 成功：患者消息 + 回合完成 + 证据/沟通状态在**同一事务**内提交；
   失败：``fail_turn``（学生消息保留，稳定错误码），绝不假装成功。

调用约定（由 chat 路由器提供）::

    ctx = await chat._build_context(...)   # 已 begin_turn，state[STATE_TURN] 是 claim
    replay = chat._resolve_turn_replay(ctx) # 命中既有回合就回放，不要进 LLM
    reply = await run_clinical_reasoning_turn(ctx)

返回 ``ChatMessageResponse``（role/content/operation），与 ``/api/chat`` 的响应形状一致。
"""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from typing import Any

from fastapi import HTTPException

from infra.llm.client import CallContext
from infra.llm.profile import get_llm_config
from modules.training.patient_ai.safety import (
    SAFETY_BLOCKED_CODE,
    SAFETY_BLOCKED_MESSAGE,
    inspect_configured_patient_reply,
)
from modules.training.pipeline.context import STATE_TURN, PipelineContext
from modules.training.pipeline.turn import (
    ERROR_INCOMPLETE,
    ERROR_LLM_EMPTY_REPLY,
    ERROR_LLM_UNAVAILABLE,
    ERROR_PROMPT_MISSING,
    TurnClaim,
    TurnStatus,
    complete_turn,
    fail_turn,
    message_content,
)
from modules.training.session.state import patch_runtime_state

from .prompts import render_contract, render_system
from .state import (
    STATE_KEY,
    evidence_entry,
    findings_index,
    initial_catalog,
    merge_state,
    objectives_of,
    obtainable_via,
    read_state,
    seed_state,
    via_channel,
)

log = logging.getLogger(__name__)

#: LLM purpose —— 配置（模型/超时/token/重试/response_format）来自 ``infra.llm.profile``，
#: 由父代理在 PROFILES 登记（不得在本模块硬编码温度/上限覆盖 profile）。
PURPOSE = "clinical_reasoning_turn"

#: 对话历史进入提示词的最大条数（与本 workflow 的回合粒度匹配；不是 token 预算）
HISTORY_LIMIT = 40

SOURCE_PATIENT = "patient"


# ── 提示词装配 ─────────────────────────────────────────────────────────────


_BACKGROUND_FIELDS = (
    ("present_illness", "本次发病经过"),
    ("past_history", "既往经历"),
    ("medication_history", "用药经历"),
    ("allergy_history", "过敏经历"),
    ("family_history", "家人健康状况"),
    ("social_history", "生活、工作与家庭"),
    ("deep_background", "你没有主动说但确实记得的顾虑与背景"),
)


def _patient_background(case_data: Mapping[str, Any]) -> str:
    """患者可经历的完整背景；不塞入 finding.note 等教师视角解释。"""
    sections: list[str] = []
    for key, title in _BACKGROUND_FIELDS:
        raw = case_data.get(key)
        if isinstance(raw, str) and raw.strip():
            sections.append(f"{title}：{raw.strip()}")
        elif isinstance(raw, Mapping):
            lines = [f"- {k!s}：{str(v).strip()}" for k, v in raw.items() if str(v).strip()]
            if lines:
                sections.append(title + "：\n" + "\n".join(lines))
    return "\n\n".join(sections)


def _known_facts(case_data: Mapping[str, Any]) -> str:
    """可披露事实与其 id 的同处映射；note 是教学注释，不进入患者脑内。"""
    lines: list[str] = []
    for finding in _inquiry_candidates(case_data):
        fid = str(finding.get("id") or "")
        label = str(finding.get("label") or "").strip()
        if fid and label:
            lines.append(f"- [{fid}] {label}")
    return "\n".join(lines)


def _inquiry_candidates(case_data: Mapping[str, Any]) -> list[dict[str, Any]]:
    """患者**可以说出**的证据：``hidden_findings`` 里 ``obtainable_via`` 含 ``inquiry`` 的。"""
    index = findings_index(case_data)
    _, hidden = initial_catalog(case_data)
    out: list[dict[str, Any]] = []
    for fid in hidden:
        finding = index.get(fid)
        if finding is None:
            continue
        channels = [via_channel(v) for v in obtainable_via(finding)]
        if "inquiry" in channels or not channels:
            out.append(finding)
    return out


def _communication_markers(case_data: Mapping[str, Any]) -> str:
    """沟通 id 与含义只对齐输出标记，不作为患者需要被讲到的内心提示。"""
    return "\n".join(
        f"- [{item.get('id')!s}] {str(item.get('cue')).strip()}"
        for item in objectives_of(case_data)["must_communicate"]
        if item.get("id") and str(item.get("cue") or "").strip()
    )


def _history_messages(ctx: PipelineContext) -> list[dict[str, str]]:
    """对话历史（system/patient/student 的原文）。"""
    rows = list(ctx.messages)[-HISTORY_LIMIT:]
    out: list[dict[str, str]] = []
    for row in rows:
        role = str(getattr(row, "role", "") or "")
        content = str(getattr(row, "content", "") or "")
        if not content.strip():
            continue
        if role == "student":
            out.append({"role": "user", "content": f"护士的发言或动作：{content}"})
        elif role == "patient":
            out.append({"role": "assistant", "content": content})
    return out


def _turn_state(case_data: Mapping[str, Any], runtime_state: Mapping[str, Any] | None) -> str:
    """把已经发生的现场事实放回患者下一轮上下文；不泄露尚未观察的结果。"""
    stored = seed_state(case_data, read_state(runtime_state))
    disclosed = [str(item.get("label")) for item in stored["evidence"] if item.get("source") == SOURCE_PATIENT]
    observed = [str(item.get("label")) for item in stored["evidence"] if item.get("source") != SOURCE_PATIENT]
    objectives = objectives_of(case_data)
    actions = {
        str(item.get("id")): str(item.get("action") or item.get("label") or "") for item in objectives["must_act"]
    }
    communications = {str(item.get("id")): str(item.get("label") or "") for item in objectives["must_communicate"]}
    completed = [actions[oid] for oid in stored["completed_objectives"] if actions.get(oid)]
    communicated = [communications[oid] for oid in stored["communicated_objectives"] if communications.get(oid)]

    sections = [
        ("你已经说过", disclosed),
        ("护士已经观察到", observed),
        ("已经实际执行", completed),
        ("已经沟通清楚", communicated),
    ]
    body = "\n".join(f"- {title}：{'；'.join(items)}" for title, items in sections if items)
    if not body:
        return ""
    return (
        "## 截至目前的现场状态\n\n"
        "这些只用于保持感受与反应连续：临床术语是给你理解现场的，不要当作患者自述背诵。\n" + body
    )


def build_turn_messages(ctx: PipelineContext) -> list[dict[str, str]]:
    """稳定人设/标记契约 → 原文历史 → 逐轮现场状态 → 本轮学生发言。"""
    case_data = ctx.case_data or {}
    patient_raw = case_data.get("patient_info")
    scenario_raw = case_data.get("scenario")
    patient: Mapping[str, Any] = patient_raw if isinstance(patient_raw, Mapping) else {}
    scenario: Mapping[str, Any] = scenario_raw if isinstance(scenario_raw, Mapping) else {}
    candidates = _inquiry_candidates(case_data)
    candidate_ids = [str(f.get("id")) for f in candidates if f.get("id")]

    system_text = render_system(
        patient_name=str(patient.get("name") or "患者"),
        patient_age=str(patient.get("age") or ""),
        patient_gender=str(patient.get("gender") or ""),
        setting=str(scenario.get("setting") or case_data.get("chief_complaint") or ""),
        communication_style=str(case_data.get("communication_style") or ""),
        background=_patient_background(case_data),
        known_facts=_known_facts(case_data),
    )
    contract = render_contract(
        disclosed_candidates=", ".join(candidate_ids),
        communicable_objectives=_communication_markers(case_data),
    )
    messages: list[dict[str, str]] = [{"role": "system", "content": f"{system_text}\n\n{contract}"}]
    messages.extend(_history_messages(ctx))
    turn_state = _turn_state(case_data, ctx.record.runtime_state)
    if turn_state:
        messages.append({"role": "system", "content": turn_state})
    student = (ctx.student_input or "").strip()
    if student:
        messages.append({"role": "user", "content": f"护士的发言或动作：{student}"})
    return messages


# ── 输出过滤 ───────────────────────────────────────────────────────────────


class FilteredReply:
    """LLM 原始输出经过**确定性过滤**后的可落库结果。"""

    __slots__ = ("communicated_ids", "disclosed_ids", "reply")

    def __init__(
        self,
        *,
        reply: str,
        disclosed_ids: list[str],
        communicated_ids: list[str],
    ) -> None:
        self.reply = reply
        self.disclosed_ids = disclosed_ids
        self.communicated_ids = communicated_ids


def _quoted_ids(raw: Any, *, source: str) -> list[str]:
    """只接受同时给出合法 id 与对应原文连续子串的标记。"""
    if not isinstance(raw, Sequence) or isinstance(raw, (str, bytes)):
        return []
    out: list[str] = []
    for item in raw:
        if not isinstance(item, Mapping):
            continue
        marker_id = item.get("id")
        quote = item.get("quote")
        if not isinstance(marker_id, str) or not isinstance(quote, str):
            continue
        marker_id = marker_id.strip()
        quote = quote.strip()
        if marker_id and quote and quote in source:
            out.append(marker_id)
    return out


def filter_reply(
    payload: Mapping[str, Any],
    *,
    case_data: Mapping[str, Any],
    runtime_state: Mapping[str, Any],
    student_input: str,
) -> FilteredReply:
    """只落库能被本轮真实原文支持的标记；自然回复不设证据数量上限。

    * ``reply`` 为空/非字符串 → 空回复（由调用方按 ``ERROR_LLM_EMPTY_REPLY`` 失败）；
    * ``disclosed_findings`` 的 quote 必须逐字来自患者 reply，id 必须合法且尚未观察；
    * ``communicated_objectives`` 的 quote 必须逐字来自本轮学生输入，且目标尚未完成。
    """
    reply = payload.get("reply")
    reply_text = reply.strip() if isinstance(reply, str) else ""

    allowed_findings = {str(f.get("id")) for f in _inquiry_candidates(case_data) if f.get("id")}
    observed = {str(item.get("finding_id")) for item in read_state(runtime_state)["evidence"]}
    raw_findings = list(dict.fromkeys(_quoted_ids(payload.get("disclosed_findings"), source=reply_text)))
    valid_findings = [fid for fid in raw_findings if fid in allowed_findings and fid not in observed]

    communicable = {str(item.get("id")) for item in objectives_of(case_data)["must_communicate"] if item.get("id")}
    already = set(read_state(runtime_state)["communicated_objectives"])
    raw_communicated = list(dict.fromkeys(_quoted_ids(payload.get("communicated_objectives"), source=student_input)))
    valid_communicated = [oid for oid in raw_communicated if oid in communicable and oid not in already]

    return FilteredReply(
        reply=reply_text,
        disclosed_ids=valid_findings,
        communicated_ids=valid_communicated,
    )


# ── 持久化（患者消息 + 证据状态，同一事务）────────────────────────────────


def _persist_success(ctx: PipelineContext, claim: TurnClaim, filtered: FilteredReply) -> Any:
    """患者消息、turn 完成状态与证据/沟通状态在同一事务提交。"""
    case_data = ctx.case_data or {}
    index = findings_index(case_data)

    def _attach_evidence(patient_msg: Any) -> None:
        new_evidence = [
            evidence_entry(index[fid], source=SOURCE_PATIENT, message_id=patient_msg.id)
            for fid in filtered.disclosed_ids
            if fid in index
        ]

        def _patch(current: dict) -> dict[str, Any]:
            base = seed_state(case_data, current.get(STATE_KEY))
            return {
                STATE_KEY: merge_state(
                    base=base,
                    evidence=new_evidence,
                    communicated=filtered.communicated_ids,
                )
            }

        merged = patch_runtime_state(ctx.db, ctx.record.id, _patch, remove=())
        ctx.record.runtime_state = merged

    return complete_turn(
        ctx.db,
        claim=claim,
        patient_content=filtered.reply,
        before_commit=_attach_evidence,
    )


def _fail(ctx: PipelineContext, claim: TurnClaim, *, code: str, message: str, partial: str | None = None) -> None:
    fail_turn(ctx.db, claim=claim, error_code=code, error_message=message, partial_reply=partial)


# ── 回合主流程 ─────────────────────────────────────────────────────────────


async def run_clinical_reasoning_turn(ctx: PipelineContext) -> Any:
    """执行一次患者回合，返回 ``ChatMessageResponse``。

    前置：``ctx`` 由 ``chat._build_context`` 构建（已 ``begin_turn``，``state[STATE_TURN]``
    是 claim）。统一回放已由路由处理；本函数负责独立生成、成功/失败持久化，
    失败以 HTTP 503 + 稳定错误码返回。
    """
    from schemas import ChatMessageResponse

    claim: TurnClaim | None = ctx.state.get(STATE_TURN)
    if claim is None:
        raise RuntimeError("clinical_reasoning 回合缺少 turn claim（必须先经 chat._build_context）")
    if claim.status == TurnStatus.COMPLETED:
        content = message_content(ctx.db, claim.patient_message_id)
        if content is None:
            raise RuntimeError("clinical_reasoning 回放的 patient_message_id 不存在")
        return ChatMessageResponse(
            role="patient",
            content=content,
            operation={"replayed": True, **claim.replay_payload},
        )

    try:
        messages = build_turn_messages(ctx)
    except Exception:
        log.exception("Clinical turn prompt build failed: record_id=%d", ctx.record.id)
        _fail(ctx, claim, code=ERROR_PROMPT_MISSING, message="提示词构建失败")
        return _failed_response(ctx, claim)

    llm_client = ctx.app_state.llm_client
    try:
        payload = await llm_client.call_json(
            messages,
            purpose=PURPOSE,
            ctx=CallContext(
                purpose=PURPOSE,
                user_id=ctx.current_user.id,
                record_id=ctx.record.id,
                case_id=ctx.record.case_id,
            ),
            **get_llm_config(PURPOSE),
        )
    except Exception:
        log.exception("Clinical turn LLM call failed: record_id=%d", ctx.record.id)
        _fail(ctx, claim, code=ERROR_LLM_UNAVAILABLE, message="LLM 服务暂时不可用，请稍后重试")
        return _failed_response(ctx, claim)

    if not isinstance(payload, Mapping):
        _fail(ctx, claim, code=ERROR_LLM_UNAVAILABLE, message="LLM 返回内容格式不正确")
        return _failed_response(ctx, claim)

    filtered = filter_reply(
        payload,
        case_data=ctx.case_data or {},
        runtime_state=ctx.record.runtime_state,
        student_input=ctx.student_input or "",
    )
    if not filtered.reply:
        _fail(ctx, claim, code=ERROR_LLM_EMPTY_REPLY, message="患者回复为空")
        return _failed_response(ctx, claim)

    # 红线在 filter 之后、persist 之前：命中就整轮失败，**不**把这段文本当 partial 落库，
    # 也不推进任何证据/沟通状态（那些状态只随患者消息一起提交）。
    violation = inspect_configured_patient_reply(filtered.reply, ctx.app_state)
    if violation is not None:
        log.warning("Clinical turn reply blocked by safety rules: record_id=%d code=%s", ctx.record.id, violation.code)
        _fail(ctx, claim, code=SAFETY_BLOCKED_CODE, message=SAFETY_BLOCKED_MESSAGE, partial=None)
        return _failed_response(ctx, claim)

    try:
        patient_msg = _persist_success(ctx, claim, filtered)
    except Exception:
        # 回合持久化失败：turn 仍 pending 会由 finalize_pending_turn 兜底标 failed；
        # 这里显式失败，保证客户端拿到错误码而不是"成功但库里没有"。
        log.exception("Clinical turn persist failed: record_id=%d", ctx.record.id)
        ctx.db.rollback()
        _fail(ctx, claim, code=ERROR_LLM_UNAVAILABLE, message="回合保存失败，请重试", partial=None)
        return _failed_response(ctx, claim)

    return ChatMessageResponse(
        role="patient",
        content=patient_msg.content,
        operation={
            **claim.replay_payload,
            "disclosed_finding_ids": filtered.disclosed_ids,
            "communicated_objective_ids": filtered.communicated_ids,
        },
    )


def _failed_response(ctx: PipelineContext, claim: TurnClaim) -> Any:
    """失败回合以 HTTP 503 + 稳定错误码返回，绝不生成空白成功消息。"""
    raise HTTPException(
        status_code=503,
        detail={
            "code": claim.error_code or ERROR_INCOMPLETE,
            "message": claim.error_message or "患者回合未完成，请重试",
            "turn_id": claim.turn_id,
            "request_id": claim.request_id,
            "student_message_id": claim.student_message_id,
            "status": str(claim.status),
        },
    )
