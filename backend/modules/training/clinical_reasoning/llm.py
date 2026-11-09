"""临床判断训练（V2）的患者回合 —— 独立 LLM 核心。

**不复用** ``history_taking`` 的五阶段 pipeline：那条链是"问诊评分"的闭包（情绪、
主动追问、护理记录注入、问诊评分提示词）。这里只做这件事：

1. 从**病例事实**装配患者视角的提示词（只含患者知道的事实、对话历史、沟通提示，
   绝不含 rubric/权重/未观察证据的结论）；
2. 一次 ``call_json``（purpose = ``clinical_reasoning_turn``，配置由 profile 提供）；
3. **过滤**模型输出：只接受 ``initial.hidden_findings`` 里 ``obtainable_via`` 含
   ``inquiry`` 的 finding、只接受已存在目标；每轮最多 2 条新证据（超出 = 本轮不记新
   证据，只交付自然澄清回复），防止"一次问全"把整段任务清单一键满分；
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

#: 每轮最多记入的**新**证据条数。超过时本轮不记新证据（只交付澄清回复）——
#: 否则"请把你所有不舒服都告诉我"一次问完就能把所有 must_notice 一键拿满。
MAX_NEW_FINDINGS_PER_TURN = 2

#: 对话历史进入提示词的最大条数（与本 workflow 的回合粒度匹配；不是 token 预算）
HISTORY_LIMIT = 40

SOURCE_PATIENT = "patient"


# ── 提示词装配 ─────────────────────────────────────────────────────────────


def _known_facts(case_data: Mapping[str, Any], *, disclosed: set[str]) -> str:
    """患者本人知道的全部问诊事实；已披露项只作标记，不从知识中删除。

    只有可见观察与 ``inquiry`` 候选进入患者知识；查体/检验结果不冒充患者自知。
    是否记为学生证据由结构化回合和运行态决定，不靠对模型隐瞒事实实现。
    """
    index = findings_index(case_data)
    visible, _ = initial_catalog(case_data)
    inquiry = [str(f.get("id")) for f in _inquiry_candidates(case_data) if f.get("id")]
    lines: list[str] = []
    for fid in [*visible, *inquiry]:
        finding = index.get(fid)
        if finding is None:
            continue
        label = str(finding.get("label") or "")
        note = str(finding.get("note") or "")
        if not label:
            continue
        suffix = "（此前已说过，不要当作新证据重复披露）" if fid in disclosed else ""
        lines.append(f"- {label}" + (f"（{note}）" if note else "") + suffix)
    return "\n".join(dict.fromkeys(lines))


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


def _communication_cues(case_data: Mapping[str, Any]) -> str:
    """沟通目标的口头指引（只给 cue 文本，不给权重/锚点/是否得分）。"""
    items = objectives_of(case_data)["must_communicate"]
    cues = [str(item.get("cue") or "").strip() for item in items if item.get("cue")]
    cues = [cue for cue in cues if cue]
    if not cues:
        return ""
    body = "\n".join(f"- {cue}" for cue in cues)
    return (
        "\n## 你可能需要被讲到的事\n\n"
        "以下是学生需要向你讲清、你才会真正知情或安心的事。"
        "如果学生没有讲到，你就保持不知情，不要主动替对方说出来。\n\n" + body + "\n"
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
            out.append({"role": "user", "content": f"护士说：{content}"})
        elif role == "patient":
            out.append({"role": "assistant", "content": content})
    return out


def build_turn_messages(ctx: PipelineContext) -> list[dict[str, str]]:
    """装配一次患者回合的完整 LLM messages。

    组成：system（病例事实 + 沟通引导 + JSON 契约）→ 历史 → 本轮学生发言。
    不含 rubric、权重、锚点、未观察证据的结论。
    """
    case_data = ctx.case_data or {}
    patient_raw = case_data.get("patient_info")
    scenario_raw = case_data.get("scenario")
    patient: Mapping[str, Any] = patient_raw if isinstance(patient_raw, Mapping) else {}
    scenario: Mapping[str, Any] = scenario_raw if isinstance(scenario_raw, Mapping) else {}
    stored = read_state(ctx.record.runtime_state)
    disclosed = {str(item.get("finding_id")) for item in stored["evidence"] if item.get("source") == SOURCE_PATIENT}
    candidates = _inquiry_candidates(case_data)
    candidate_ids = [str(f.get("id")) for f in candidates if f.get("id")]
    communicable = [str(item.get("id")) for item in objectives_of(case_data)["must_communicate"] if item.get("id")]

    system_text = render_system(
        patient_name=str(patient.get("name") or "患者"),
        patient_age=str(patient.get("age") or ""),
        patient_gender=str(patient.get("gender") or ""),
        setting=str(scenario.get("setting") or case_data.get("chief_complaint") or ""),
        communication_style=str(case_data.get("communication_style") or ""),
        known_facts=_known_facts(case_data, disclosed=disclosed),
        communication_cues=_communication_cues(case_data),
    )
    contract = render_contract(
        disclosed_candidates=", ".join(candidate_ids),
        communicable_objectives=", ".join(communicable),
    )
    messages: list[dict[str, str]] = [{"role": "system", "content": f"{system_text}\n\n{contract}"}]
    messages.extend(_history_messages(ctx))
    student = (ctx.student_input or "").strip()
    if student:
        messages.append({"role": "user", "content": f"护士说：{student}"})
    return messages


# ── 输出过滤 ───────────────────────────────────────────────────────────────


class FilteredReply:
    """LLM 原始输出经过**确定性过滤**后的可落库结果。"""

    __slots__ = ("communicated_ids", "disclosed_ids", "overflow", "reply")

    def __init__(
        self,
        *,
        reply: str,
        disclosed_ids: list[str],
        communicated_ids: list[str],
        overflow: bool,
    ) -> None:
        self.reply = reply
        self.disclosed_ids = disclosed_ids
        self.communicated_ids = communicated_ids
        self.overflow = overflow


def _string_list(raw: Any) -> list[str]:
    if not isinstance(raw, Sequence) or isinstance(raw, (str, bytes)):
        return []
    return [str(item).strip() for item in raw if isinstance(item, str) and item.strip()]


def filter_reply(
    payload: Mapping[str, Any], *, case_data: Mapping[str, Any], runtime_state: Mapping[str, Any]
) -> FilteredReply:
    """把模型 JSON 收敛成可落库的事实：非法 id 丢弃，超量则整轮不记新证据。

    规则（确定性，不依赖模型自觉）：

    * ``reply`` 为空/非字符串 → 空回复（由调用方按 ``ERROR_LLM_EMPTY_REPLY`` 失败）；
    * ``disclosed_finding_ids`` 只保留「患者可以说出」且**尚未观察**的 id；
    * 去重后超过 :data:`MAX_NEW_FINDINGS_PER_TURN` → ``overflow=True``，本轮不记任何新证据；
    * ``communicated_objective_ids`` 只保留已存在的 ``must_communicate`` 目标，且必须是
      **本轮新**完成的（已在 ``communicated_objectives`` 里的不重复记）。
    """
    reply = payload.get("reply")
    reply_text = reply.strip() if isinstance(reply, str) else ""

    allowed_findings = {str(f.get("id")) for f in _inquiry_candidates(case_data) if f.get("id")}
    observed = {str(item.get("finding_id")) for item in read_state(runtime_state)["evidence"]}
    raw_findings = list(dict.fromkeys(_string_list(payload.get("disclosed_finding_ids"))))
    valid_findings = [fid for fid in raw_findings if fid in allowed_findings and fid not in observed]

    overflow = len(valid_findings) > MAX_NEW_FINDINGS_PER_TURN
    if overflow:
        log.warning(
            "Clinical turn disclosed too many findings at once (%d > %d); dropping disclosures this turn",
            len(valid_findings),
            MAX_NEW_FINDINGS_PER_TURN,
        )
        valid_findings = []

    communicable = {str(item.get("id")) for item in objectives_of(case_data)["must_communicate"] if item.get("id")}
    already = set(read_state(runtime_state)["communicated_objectives"])
    valid_communicated = [
        oid for oid in dict.fromkeys(_string_list(payload.get("communicated_objective_ids"))) if oid in communicable
    ]
    valid_communicated = [oid for oid in valid_communicated if oid not in already]

    return FilteredReply(
        reply=reply_text,
        disclosed_ids=valid_findings,
        communicated_ids=valid_communicated,
        overflow=overflow,
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

    filtered = filter_reply(payload, case_data=ctx.case_data or {}, runtime_state=ctx.record.runtime_state)
    if not filtered.reply:
        _fail(ctx, claim, code=ERROR_LLM_EMPTY_REPLY, message="患者回复为空")
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
            "status": str(claim.status),
        },
    )
