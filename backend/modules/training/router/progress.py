from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import get_current_user
from infra.llm.client import CallContext
from models import Case, Message, TrainingRecord, User
from modules.training.capabilities import is_enabled
from modules.training.patient_ai.emotion import EmotionRepository
from modules.training.patient_ai.initiative import (
    MAX_INITIATIVE_COUNT,
    apply_initiative_penalty,
    generate_initiative_llm,
    update_initiative_timer,
)
from schemas import InitiativeTriggerResponse

router = APIRouter()


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

    repo = EmotionRepository()
    state = repo.get_or_create(record_id, db)
    vector = state.vector

    msg = await generate_initiative_llm(
        request.app.state.llm_client,
        personality,
        vector,
        case_data.get("name", "未知病例"),
        recent_student_msg="",
        ctx=CallContext(
            purpose="patient_chat",
            user_id=current_user.id,
            record_id=record_id,
            case_id=record.case_id,
        ),
    )

    if msg:
        now = datetime.now(UTC)
        patient_msg = Message(record_id=record_id, role="patient", content=msg, created_at=now)
        db.add(patient_msg)
        db.flush()
        db.refresh(patient_msg)

        count = request.app.state.initiative_cache.increment_count(record_id, db)
        emotion_data = apply_initiative_penalty(record_id, request.app.state.initiative_cache, db)

        if count < MAX_INITIATIVE_COUNT:
            update_initiative_timer(record_id, request.app.state.initiative_cache, db)

        try:
            db.commit()
        except Exception:
            db.rollback()
            raise
        return {"triggered": True, "message": msg, "id": patient_msg.id, "emotion": emotion_data}

    return {"triggered": False, "message": None}
