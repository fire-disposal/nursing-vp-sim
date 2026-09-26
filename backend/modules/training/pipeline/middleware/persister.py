"""persister — 事务 B：患者消息 + turn 收尾（见 pipeline/turn.py）。

两阶段持久化后，本中间件**不再插入学生消息**：学生在事务 A（``begin_turn``，
任何 LLM 调用之前）就已落库，因此 LLM 失败/断线不会吞掉学生这一句。

分流：
  * 正常：``complete_turn`` → 患者消息 + turn(completed) → 一个事务；
  * 失败（ctx.error / shortcut）：``fail_turn`` → turn(failed) + 稳定错误码 →
    学生消息保留；若已有可下发的部分回复，一并落库（前端仍拿到错误码）；
  * 修正：整对消息替换 + 修正计数，仍在单一事务内（旧消息在新回复成功后才删）；
  * 无 turn 声明：拒绝写入并记账 —— 半截持久化正是本切片消灭的缺陷。
"""

import logging

from models import Message
from modules.training.patient_ai.initiative import update_initiative_timer

from ..context import (
    STATE_CORRECTION_TARGET,
    STATE_DONE_PAYLOAD,
    STATE_SAVED_MESSAGES,
    STATE_TURN,
    PipelineContext,
)
from ..turn import (
    ERROR_CLAIM_MISSING,
    ERROR_INCOMPLETE,
    complete_turn,
    fail_turn,
)

log = logging.getLogger(__name__)


async def persister(ctx: PipelineContext, next_mw) -> None:
    if ctx.state.get(STATE_CORRECTION_TARGET):
        _persist_correction(ctx)
        await next_mw()
        return

    claim = ctx.state.get(STATE_TURN)
    if claim is None:
        # 调用方绕过了 begin_turn：不写任何消息（写一半比不写更危险），并留下明确错误
        log.error("Chat turn claim missing; refusing to persist messages: record_id=%d", ctx.record.id)
        ctx.error = ctx.error or "对话回合状态缺失"
        ctx.error_code = ERROR_CLAIM_MISSING
        await next_mw()
        return

    if ctx.error or ctx.should_shortcut:
        _persist_failure(ctx, claim)
    else:
        _persist_success(ctx, claim)
    await next_mw()


def _persist_success(ctx: PipelineContext, claim) -> None:
    """事务 B（成功）：患者消息 + turn(completed)。"""
    patient_msg = complete_turn(ctx.db, claim=claim, patient_content=ctx.llm_reply or "")
    ctx.state[STATE_SAVED_MESSAGES] = [patient_msg]
    log.info(
        "Persisted: record_id=%d turn_id=%d student=%d patient=%d",
        ctx.record.id,
        claim.turn_id,
        len(ctx.student_input),
        len(ctx.llm_reply or ""),
    )
    _reset_initiative_timer(ctx)


def _persist_failure(ctx: PipelineContext, claim) -> None:
    """事务 B（失败）：turn(failed) + 错误码；学生消息已在事务 A 落库。"""
    patient_msg = fail_turn(
        ctx.db,
        claim=claim,
        error_code=ctx.error_code or ERROR_INCOMPLETE,
        error_message=ctx.error or "回合未完成",
        partial_reply=ctx.llm_reply,
    )
    if patient_msg is not None:
        ctx.state[STATE_SAVED_MESSAGES] = [patient_msg]
        log.warning("Persisted partial reply after error: record_id=%d len=%d", ctx.record.id, len(ctx.llm_reply or ""))


def _persist_correction(ctx: PipelineContext) -> None:
    """Replace the last student/patient pair after the replacement reply succeeds."""
    target = ctx.state.get(STATE_CORRECTION_TARGET) or {}
    old_student = target.get("student")
    old_patient = target.get("patient")
    if old_student is None:
        raise ValueError("correction target missing student message")

    # 旧值先快照成纯数据：资格校验后事务已被提交（属性过期），而 delete+flush 之后再读
    # 旧实例的属性会对已删除行触发刷新并抛 ObjectDeletedError。
    old = {
        "old_student_id": old_student.id,
        "old_student_content": old_student.content,
        "old_patient_id": getattr(old_patient, "id", None),
        "old_patient_content": getattr(old_patient, "content", None),
    }

    if old_patient is not None:
        ctx.db.delete(old_patient)
    ctx.db.delete(old_student)
    ctx.db.flush()

    student_msg = Message(record_id=ctx.record.id, role="student", content=ctx.student_input)
    ctx.db.add(student_msg)

    patient_msg = Message(record_id=ctx.record.id, role="patient", content=ctx.llm_reply or "")
    ctx.db.add(patient_msg)
    ctx.db.flush()

    correction = _next_correction_state(
        ctx.record.runtime_state or {},
        old=old,
        student_msg=student_msg,
        patient_msg=patient_msg,
    )
    runtime_state = dict(ctx.record.runtime_state or {})
    runtime_state["message_correction"] = correction
    ctx.record.runtime_state = runtime_state

    ctx.db.commit()
    ctx.db.refresh(student_msg)
    ctx.db.refresh(patient_msg)
    ctx.state[STATE_SAVED_MESSAGES] = [student_msg, patient_msg]
    ctx.state[STATE_DONE_PAYLOAD] = {
        "student_id": student_msg.id,
        "patient_id": patient_msg.id,
        "corrections_used": correction["used"],
        "corrections_remaining": max(0, correction["limit"] - correction["used"]),
    }
    log.info(
        "Corrected last message: record_id=%d old_student=%s old_patient=%s new_student=%d new_patient=%d",
        ctx.record.id,
        old["old_student_id"],
        old["old_patient_id"],
        student_msg.id,
        patient_msg.id,
    )
    _reset_initiative_timer(ctx)


def _next_correction_state(
    runtime_state: dict,
    *,
    old: dict,
    student_msg,
    patient_msg,
) -> dict:
    current = runtime_state.get("message_correction")
    if not isinstance(current, dict):
        current = {}
    limit = int(current.get("limit") or 3)
    used = int(current.get("used") or 0) + 1
    history = current.get("history")
    if not isinstance(history, list):
        history = []
    history = [
        *history[-2:],
        {
            **old,
            "new_student_id": student_msg.id,
            "new_patient_id": patient_msg.id,
        },
    ]
    return {"used": used, "limit": limit, "history": history}


def _reset_initiative_timer(ctx: PipelineContext) -> None:
    """Reset initiative timer in its own transaction; failures don't affect messages."""
    try:
        app_state = ctx.app_state
        if hasattr(app_state, "initiative_cache") and app_state.initiative_cache is not None:
            update_initiative_timer(ctx.record.id, app_state.initiative_cache, ctx.db)
            ctx.db.commit()
    except Exception:
        try:
            ctx.db.rollback()
        except Exception:
            log.warning("Rollback failed after initiative timer error", exc_info=True)
        log.warning("Failed to reset initiative timer: record_id=%d", ctx.record.id, exc_info=True)
