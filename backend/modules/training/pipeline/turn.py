"""对话回合的两阶段持久化（durable turn）与幂等（docs/15 §五/§八）。

修复前的缺陷：SSE 路径把「准入守卫 → 读消息窗口 → 情绪分析(LLM) → prompt 构建 →
患者回复流式(LLM) → 身份/泄漏守卫」全塞在一个隐式事务里，直到 ``persister`` 才
``commit()``。后果：

* LLM 失败/中途断开 → **学生这句话根本没落库**（整轮静默丢失）；
* 整段 LLM 流式期间持有数据库连接与事务（连接被长事务占满）；
* 请求没有幂等键 → 客户端重发即重复插入学生消息。

本模块把回合切成两段，边界固定且不含任何 LLM 调用：

===============  ===========================================================
事务 A           学生消息 + turn(pending) → commit（**必须在任何 LLM 调用之前**）
（LLM / 推送）    不持有数据库事务
事务 B           患者消息 + turn(completed|failed) → commit
===============  ===========================================================

turn 记录落在既有的唯一审计表 ``training_actions``：它本来就承担
``UNIQUE(record_id, request_id)`` 的幂等语义（docs/15 §五），``kind=chat_turn``，
状态在 ``result`` JSONB 内。**不新增表、不新增迁移。**

失败语义（docs/15 §五「系统终止与用户主动完成必须区分」的同精神）：
LLM 失败/中断只把 turn 标 ``failed`` + 稳定错误码，学生消息保留；重放同一
``request_id`` 不会把失败当作成功，也不会产生第二条学生消息。客户端换新
``request_id`` 重发 = 新回合（学生那句话确实说了两次），旧回合的行仍在，
可供审计与评分。
"""

from __future__ import annotations

import contextlib
import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy.exc import IntegrityError

from core.datetime_utils import ensure_utc
from core.exceptions import ValidationError
from models import Message, TrainingAction, TrainingRecord

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

log = logging.getLogger(__name__)

#: 回合的审计 kind —— 与 Activity command 的 kind 不重叠（评分只读 kind=activity_id）
TURN_KIND = "chat_turn"

#: 幂等键字符集与长度：直接落 String(64) 列，先于 DB 拒绝非法输入。
_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")

#: pending 超过该秒数视为「上一进程死在这一轮」：允许同一 request_id  resumed
#: （沿用已落库的学生消息重跑 LLM），而不是让客户端永远等到 409。
TURN_PENDING_STALE_SECONDS = 180

#: 稳定错误码：客户端与遥测按码分支，不再解析中文文案。
ERROR_LLM_UNAVAILABLE = "chat.llm_unavailable"
ERROR_LLM_EMPTY_REPLY = "chat.llm_empty_reply"
ERROR_PROMPT_MISSING = "chat.prompt_missing"
ERROR_PIPELINE = "chat.pipeline_error"
ERROR_INCOMPLETE = "chat.turn_incomplete"
ERROR_CLAIM_MISSING = "chat.turn_claim_missing"

#: HTTP 409 的稳定码：同键请求仍在生成中 / 同键请求与已落库回合冲突 / 回合已被修正替换
CODE_TURN_IN_PROGRESS = "chat.turn_in_progress"
CODE_TURN_CONFLICT = "chat.turn_conflict"
CODE_TURN_SUPERSEDED = "chat.turn_superseded"


class TurnStatus(StrEnum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"


class TurnConflict(Exception):
    """幂等键冲突：键被别的操作占用，或同键请求的正文与已落库回合不一致。

    调用方（router）应回 409 + 稳定码；不得静默改写已落库的回合。
    """


@dataclass
class TurnClaim:
    """一次对话回合的持久化句柄（事务 A 的产物，由 persister 在事务 B 收尾）。"""

    turn_id: int
    record_id: int
    request_id: str
    status: str
    student_message_id: int | None = None
    patient_message_id: int | None = None
    error_code: str | None = None
    error_message: str | None = None
    #: 回合起始时刻（ISO-8601，事务 A 写入，供陈旧判定与回合耗时审计）
    started_at: str | None = None
    #: 命中既有回合（完成/失败）→ 调用方不得重复开始 LLM，直接回放。
    replayed: bool = False
    #: 陈旧 pending 被重新认领 → 沿用既有学生消息，重跑一次 LLM。
    resumed: bool = False

    @property
    def replay_payload(self) -> dict:
        return {
            "turn_id": self.turn_id,
            "request_id": self.request_id,
            "status": str(self.status),
            "student_message_id": self.student_message_id,
            "patient_message_id": self.patient_message_id,
            "error_code": self.error_code,
        }


def normalize_request_id(request_id: str | None) -> str:
    """校验/生成幂等键。缺省（老客户端）生成一个，保证每轮都有 turn 记录。"""
    raw = (request_id or "").strip()
    if not raw:
        return uuid4().hex
    if not _REQUEST_ID_RE.match(raw):
        raise ValidationError(detail="request_id 非法（1-64 位，字母/数字/._:-）")
    return raw


def _iso_now() -> str:
    """回合起始时刻（tz-aware ISO-8601，落在 ``result.started_at``）。

    为什么不用 ``training_actions.created_at`` 算 pending 时长：该列是
    ``timestamp without time zone``，而写入值是 tz-aware 的 ``datetime.now(UTC)``
    —— 驱动按库会话时区落成**本地墙上时间**（已验证：UTC 09:35 存成 17:35+08），
    再按 UTC 解读会得到 -8h 的年龄，陈旧判定永远不触发。JSONB 里的 ISO 串
    自带偏移，跨部署/跨时区都只有一种解释。
    """
    return datetime.now(UTC).isoformat()


def _turn_row(db: Session, record_id: int, request_id: str) -> TrainingAction | None:
    return (
        db.query(TrainingAction)
        .filter(TrainingAction.record_id == record_id, TrainingAction.request_id == request_id)
        .first()
    )


def _started_at(stored: dict) -> datetime | None:
    raw = stored.get("started_at")
    if not isinstance(raw, str):
        return None
    try:
        return ensure_utc(datetime.fromisoformat(raw))
    except ValueError:
        log.warning("Chat turn has unparsable started_at: %r", raw)
        return None


def _claim_from_row(row: TrainingAction, *, content: str, now: datetime) -> TurnClaim:
    """把既有 turn 行还原成 claim（回放/续跑），并校验同键请求的正文一致。"""
    if row.kind != TURN_KIND:
        raise TurnConflict(f"request_id 已被其他操作占用（kind={row.kind}）")

    stored = row.result or {}
    stored_content = str((row.input or {}).get("content") or "")
    if stored_content.strip() != content.strip():
        raise TurnConflict("request_id 复用了不同内容：已落库回合不可改写")

    claim = TurnClaim(
        turn_id=row.id,
        record_id=row.record_id,
        request_id=row.request_id,
        status=str(stored.get("status") or TurnStatus.PENDING),
        student_message_id=stored.get("student_message_id"),
        patient_message_id=stored.get("patient_message_id"),
        error_code=stored.get("error_code"),
        error_message=stored.get("error"),
        started_at=stored.get("started_at"),
    )
    if claim.status == TurnStatus.PENDING:
        started = _started_at(stored)
        age = (now - started).total_seconds() if started is not None else 0.0
        if age < TURN_PENDING_STALE_SECONDS:
            claim.replayed = True  # 仍在生成中（或无法判定年龄）：不重复开始 LLM
        else:
            claim.resumed = True  # 上一进程死在这一轮：沿用学生消息重跑
            log.warning(
                "Resuming stale pending chat turn: record_id=%d request_id=%s age=%.0fs",
                row.record_id,
                row.request_id,
                age,
            )
    else:
        claim.replayed = True
    return claim


def begin_turn(db: Session, *, record: TrainingRecord, request_id: str | None, content: str) -> TurnClaim:
    """事务 A：学生消息 + turn(pending) → commit。

    行锁只覆盖「认领」这一段：同一记录的并发回合在此串行，认领完成即提交释放，
    LLM 与流式推送期间不持有任何事务。返回的 claim 交给 persister 在事务 B 收尾。
    """
    locked = db.query(TrainingRecord).filter(TrainingRecord.id == record.id).with_for_update().first()
    if locked is None:
        raise ValidationError(detail="训练记录不存在")

    rid = normalize_request_id(request_id)
    existing = _turn_row(db, record.id, rid)
    if existing is not None:
        claim = _claim_from_row(existing, content=content, now=datetime.now(UTC))
        db.rollback()  # 释放行锁；既有回合不需要事务 A 的任何写入
        return claim

    started_at = _iso_now()
    student_msg = Message(record_id=record.id, role="student", content=content)
    turn_row = TrainingAction(
        record_id=record.id,
        request_id=rid,
        kind=TURN_KIND,
        input={"content": content},
        result={"status": str(TurnStatus.PENDING), "started_at": started_at},
    )
    db.add(student_msg)
    db.add(turn_row)
    try:
        db.flush()
    except IntegrityError:
        # 认领竞态（跨进程/同进程并发）：另一路已抢先插行 → 回放它，绝不重复插学生消息
        db.rollback()
        row = _turn_row(db, record.id, rid)
        if row is None:
            raise
        return _claim_from_row(row, content=content, now=datetime.now(UTC))

    claim = TurnClaim(
        turn_id=turn_row.id,
        record_id=record.id,
        request_id=rid,
        status=str(TurnStatus.PENDING),
        student_message_id=student_msg.id,
        started_at=started_at,
    )
    turn_row.result = {
        "status": str(TurnStatus.PENDING),
        "student_message_id": student_msg.id,
        "started_at": started_at,
    }
    db.commit()
    log.info(
        "Chat turn started: record_id=%d turn_id=%d student_message_id=%d",
        record.id,
        claim.turn_id,
        claim.student_message_id,
    )
    return claim


def complete_turn(db: Session, *, claim: TurnClaim, patient_content: str) -> Message:
    """事务 B（成功）：患者消息 + turn(completed) → commit。"""
    patient_msg = Message(record_id=claim.record_id, role="patient", content=patient_content)
    db.add(patient_msg)
    db.flush()
    _write_result(
        db,
        claim,
        {
            "status": str(TurnStatus.COMPLETED),
            "student_message_id": claim.student_message_id,
            "patient_message_id": patient_msg.id,
            "started_at": claim.started_at,
            "completed_at": datetime.now(UTC).isoformat(),
        },
    )
    claim.status = str(TurnStatus.COMPLETED)
    claim.patient_message_id = patient_msg.id
    claim.error_code = None
    claim.error_message = None
    db.commit()
    db.refresh(patient_msg)
    log.info(
        "Chat turn completed: record_id=%d turn_id=%d patient_message_id=%d",
        claim.record_id,
        claim.turn_id,
        patient_msg.id,
    )
    return patient_msg


def fail_turn(
    db: Session,
    *,
    claim: TurnClaim,
    error_code: str,
    error_message: str,
    partial_reply: str | None = None,
) -> Message | None:
    """事务 B（失败）：turn(failed) + 稳定错误码 → commit；学生消息保留。

    ``partial_reply``（仅当模型已产出可下发文本时）一并落库：文案是真实的患者输出，
    不能因为随后守卫/持久化失败而丢失；turn 仍标记 failed，前端拿到错误码。
    """
    patient_msg: Message | None = None
    if partial_reply and partial_reply.strip():
        patient_msg = Message(record_id=claim.record_id, role="patient", content=partial_reply)
        db.add(patient_msg)
        db.flush()
    _write_result(
        db,
        claim,
        {
            "status": str(TurnStatus.FAILED),
            "error_code": error_code,
            "error": error_message,
            "student_message_id": claim.student_message_id,
            "patient_message_id": patient_msg.id if patient_msg is not None else None,
            "started_at": claim.started_at,
            "failed_at": datetime.now(UTC).isoformat(),
        },
    )
    claim.status = str(TurnStatus.FAILED)
    claim.error_code = error_code
    claim.error_message = error_message
    claim.patient_message_id = patient_msg.id if patient_msg is not None else None
    db.commit()
    if patient_msg is not None:
        db.refresh(patient_msg)
    log.warning(
        "Chat turn failed: record_id=%d turn_id=%d code=%s student_message_kept=%s",
        claim.record_id,
        claim.turn_id,
        error_code,
        claim.student_message_id,
    )
    return patient_msg


def _write_result(db: Session, claim: TurnClaim, result: dict) -> None:
    row = db.get(TrainingAction, claim.turn_id)
    if row is None:
        # 不应发生（事务 A 刚写的行）；显式失败好过静默留下 pending
        raise TurnConflict(f"turn 行不存在: turn_id={claim.turn_id}")
    row.result = result


def message_content(db: Session, message_id: int | None) -> str | None:
    """按 id 取消息正文（幂等回放用，不复制正文到审计行）。"""
    if message_id is None:
        return None
    row = db.get(Message, message_id)
    return row.content if row is not None else None


async def finalize_pending_turn(ctx) -> None:
    """兜底：链路异常结束时把仍 pending 的回合标 failed（绝不静默留在 pending）。

    正常路径由 ``persister`` 收尾；只有中间件抛异常（run_pipeline 吞掉异常、
    persister 没跑到）时才会走到这里。DB 不可用时只记日志——回合本身已 durable
    （学生消息已落库），下一次同 request_id 重放会因陈旧而被重新认领。
    """
    from .context import STATE_TURN

    claim: TurnClaim | None = ctx.state.get(STATE_TURN)
    if claim is None or claim.status != TurnStatus.PENDING:
        return
    code = getattr(ctx, "error_code", None) or ERROR_INCOMPLETE
    message = ctx.error or "回合未完成"
    try:
        fail_turn(ctx.db, claim=claim, error_code=code, error_message=message)
    except Exception:
        log.exception("Failed to finalize pending chat turn: record_id=%d turn_id=%d", claim.record_id, claim.turn_id)
        with contextlib.suppress(Exception):
            ctx.db.rollback()
