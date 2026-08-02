import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

log = logging.getLogger(__name__)

from core.database import get_db
from core.security import get_current_user
from infra.llm.client import CallContext
from models import Case, Message, TrainingRecord, User
from modules.training.capabilities import is_enabled
from modules.training.patient_ai.emotion import EmotionRepository
from modules.training.patient_ai.initiative import (
    apply_initiative_penalty,
    build_patient_context,
    can_initiate,
    derive_initiative_policy,
    generate_initiative_llm,
    mark_initiative_triggered,
)
from schemas import InitiativeTriggerResponse

router = APIRouter()


def _build_initiative_context(db: Session, record_id: int) -> tuple[str, str]:
    """取最近两轮对话，返回 (学生最后消息, 上下文文本)。"""
    recent = db.query(Message).filter(Message.record_id == record_id).order_by(Message.created_at.desc()).limit(4).all()
    recent.reverse()
    lines = []
    student_msg = ""
    for m in recent:
        if m.role in ("student", "patient"):
            lines.append(f"{'护士' if m.role == 'student' else '患者'}：{m.content}")
            if m.role == "student" and not student_msg:
                student_msg = m.content
    return student_msg, "\n".join(lines[-4:])


@router.post("/{record_id}/initiative/trigger", response_model=InitiativeTriggerResponse)
async def trigger_initiative(
    record_id: int,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if record.user_id != current_user.id and not current_user.has_permission("score_review"):
        raise HTTPException(status_code=403, detail="无权限")

    if not is_enabled(record, "patient_initiative"):
        return {"triggered": False, "message": None}

    case = db.query(Case).filter(Case.id == record.case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")

    case_data = case.case_data or {}
    personality = case_data.get("personality", {})
    app_state = request.app.state
    cache = app_state.initiative_cache

    repo = EmotionRepository()
    state = repo.get_or_create(record_id, db)
    vector = state.vector

    # ── 决策 + 守卫：后端唯一权威，未过守卫绝不生成/写入 ──
    policy = derive_initiative_policy(vector, personality)
    allowed, reason = can_initiate(record_id, cache, db, policy)
    if not allowed:
        return {"triggered": False, "message": None}

    # ── 真实上下文：最近两轮对话 + 学生最后消息 ──
    student_msg, context_tail = _build_initiative_context(db, record_id)

    msg = await generate_initiative_llm(
        request.app.state.llm_client,
        vector,
        personality,
        case_data.get("name", "未知病例"),
        student_msg=student_msg,
        context_tail=context_tail,
        patient_context=build_patient_context(case_data),
        ctx=CallContext(
            purpose="patient_chat",
            user_id=current_user.id,
            record_id=record_id,
            case_id=record.case_id,
        ),
    )

    if msg:
        # ── 出站守卫：主动追问绕过了 llm_caller 的泄漏检查，这里必须补上 ──
        from modules.training.context.leak_guard import find_hidden_topic_leaks
        from modules.training.patient_ai.guards import has_identity_leak

        if has_identity_leak(msg) or find_hidden_topic_leaks(msg, case_data, student_msg):
            log.warning("Initiative message leaked, discarding: record_id=%d", record_id)
            return {"triggered": False, "message": None}

        now = datetime.now(UTC)
        patient_msg = Message(record_id=record_id, role="patient", content=msg, created_at=now)
        db.add(patient_msg)
        db.flush()
        db.refresh(patient_msg)

        mark_initiative_triggered(record_id, cache, db)
        emotion_data = apply_initiative_penalty(record_id, cache, db)

        try:
            db.commit()
        except Exception:
            db.rollback()
            raise
        return {
            "triggered": True,
            "message": msg,
            "id": patient_msg.id,
            "emotion": emotion_data,
        }

    return {"triggered": False, "message": None}
