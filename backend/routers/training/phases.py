import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import get_current_user
from models import Case, Message, TrainingRecord, User
from schemas import (
    InitiativeTriggerResponse,
    PhaseAdvanceResponse,
    TrainingStateResponse,
)
from services.patient_ai import (
    generate_initiative,
    get_emotion,
    get_initiative_seconds,
    should_initiate,
    update_initiative_timer,
)
from services.pipeline.phase import parse_phases, try_advance_phase
from services.feature_flags import is_enabled, resolve_features

log = logging.getLogger(__name__)

router = APIRouter()


@router.post("/{record_id}/advance-phase", response_model=PhaseAdvanceResponse)
def advance_phase(
    record_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能操作自己的训练")
    if record.status != "in_progress":
        raise HTTPException(status_code=400, detail="训练已结束")

    case = db.query(Case).filter(Case.id == record.case_id).first()
    case_data = case.case_data or {} if case else {}

    phases = parse_phases(case_data)
    current = None
    for p in phases:
        if p.id == (record.current_phase or "history_taking"):
            current = p
            break
    if current is None:
        current = phases[0] if phases else None

    if current is None:
        raise HTTPException(status_code=400, detail="当前无有效阶段")

    msg_count = db.query(Message).filter(Message.record_id == record_id).count()
    op_count = case_data.get("_phase_op_count", 0)

    next_phase = try_advance_phase(current, phases, msg_count, op_count, manual_requested=True)
    if next_phase is None:
        raise HTTPException(status_code=400, detail="不满足推进条件或已是最后一个阶段")

    record.current_phase = next_phase.id
    case_data["_phase_op_count"] = 0
    case.case_data = case_data
    db.commit()

    log.info("Phase advanced: record_id=%d %s -> %s", record_id, current.id, next_phase.id)
    return {"current_phase": next_phase.id, "name": next_phase.name, "order": next_phase.order}


@router.get("/{record_id}/state", response_model=TrainingStateResponse)
def get_training_state(
    record_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if record.user_id != current_user.id and not current_user.has_permission("score_review"):
        raise HTTPException(status_code=403, detail="无权限")

    case = db.query(Case).filter(Case.id == record.case_id).first()
    case_data = case.case_data or {}

    emotion = get_emotion(record_id)
    config = record.config_snapshot or {}

    personality = case_data.get("personality", {})
    elapsed, threshold = get_initiative_seconds(record_id, personality, emotion.score)

    return {
        "record_id": record_id,
        "case_id": record.case_id,
        "emotion": {
            "score": emotion.score,
            "state": emotion.state,
            "note": emotion.note,
        },
        "personality": personality,
        "deep_background_keys": list(case_data.get("deep_background", {}).keys()),
        "exam_anchors": {
            k: v for k, v in case_data.get("exam_anchors", {}).items()
        },
        "config": {
            "id": record.config_id,
            "mode": config.get("mode"),
            "features": resolve_features(record.config_snapshot),
        },
        "initiative": {
            "elapsed_seconds": round(elapsed, 1),
            "threshold_seconds": round(threshold, 1),
            "percent": round(min(100, elapsed / threshold * 100), 1),
        },
    }


@router.post("/{record_id}/initiative/trigger", response_model=InitiativeTriggerResponse)
def trigger_initiative(
    record_id: int,
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
    emotion = get_emotion(record_id)

    if not should_initiate(record_id, personality, emotion.score):
        return {"triggered": False, "message": None}

    msg = generate_initiative(
        personality,
        emotion.score,
        emotion.state,
        wait_seconds=60,
    )

    if msg:
        now = datetime.now(UTC)
        patient_msg = Message(record_id=record_id, role="patient", content=msg, created_at=now)
        db.add(patient_msg)
        db.commit()
        db.refresh(patient_msg)
        update_initiative_timer(record_id, len(msg))
        return {"triggered": True, "message": msg, "id": patient_msg.id}

    return {"triggered": False, "message": None}
