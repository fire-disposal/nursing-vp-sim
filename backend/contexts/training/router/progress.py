import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from contexts.patient import (
    generate_initiative,
    get_emotion,
    handle_operation,
    should_initiate,
    update_initiative_timer,
)
from core.database import get_db
from core.feature_flags import is_enabled, resolve_features
from core.security import get_current_user
from models import Case, Message, TrainingRecord, User
from schemas import (
    InitiativeTriggerResponse,
    PhaseAdvanceResponse,
    TrainingStateResponse,
)

from ..pipeline.phase import parse_phases, try_advance_phase

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
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")
    case_data = case.case_data or {}
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
    op_count = (record.practice_snapshot or {}).get("_phase_op_count", 0)

    next_phase = try_advance_phase(current, phases, msg_count, op_count, manual_requested=True)
    if next_phase is None:
        raise HTTPException(status_code=400, detail="不满足推进条件或已是最后一个阶段")

    record.current_phase = next_phase.id
    snapshot = record.practice_snapshot or {}
    snapshot["_phase_op_count"] = 0
    record.practice_snapshot = snapshot
    db.commit()

    log.info("Phase advanced: record_id=%d %s -> %s", record_id, current.id, next_phase.id)
    return {"current_phase": next_phase.id, "name": next_phase.name, "order": next_phase.order}


@router.get("/{record_id}/state", response_model=TrainingStateResponse)
def get_training_state(
    record_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    request: Request,
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if record.user_id != current_user.id and not current_user.has_permission("score_review"):
        raise HTTPException(status_code=403, detail="无权限")

    case = db.query(Case).filter(Case.id == record.case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")
    case_data = case.case_data or {}
    app_state = request.app.state
    features = resolve_features(record.practice_snapshot)
    config = record.practice_snapshot or {}
    personality = case_data.get("personality", {})

    emotion_data = None
    if features.get("emotion"):
        emotion = get_emotion(record_id, app_state.emotion_cache)
        emotion_history = getattr(emotion, "history", [])
        emotion_data = {
            "trust": emotion.trust,
            "comfort": emotion.comfort,
            "state": emotion.state,
            "note": emotion.note,
            "history": emotion_history[-20:],
        }
    else:
        emotion = None

    initiative_data = None
    if features.get("patient_initiative"):
        total_elapsed = (datetime.now(UTC) - record.start_time).total_seconds()
        initiative_data = {
            "elapsed_seconds": round(total_elapsed, 1),
            "percent": 0,
        }

    return {
        "record_id": record_id,
        "case_id": record.case_id,
        "emotion": emotion_data,
        "personality": personality,
        "deep_background_keys": list(case_data.get("deep_background", {}).keys()),
        "exam_anchors": case_data.get("exam_anchors", {}),
        "config": {
            "mode": config.get("mode"),
            "features": features,
        },
        "initiative": initiative_data,
        "current_phase": record.current_phase or "history_taking",
        "feature_flags": features,
    }


@router.post("/{record_id}/initiative/trigger", response_model=InitiativeTriggerResponse)
def trigger_initiative(
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
    emotion = get_emotion(record_id, app_state.emotion_cache)

    if not should_initiate(record_id, app_state.initiative_cache, personality, emotion.trust, emotion.comfort):
        return {"triggered": False, "message": None}

    msg = generate_initiative(personality, emotion.trust, emotion.comfort, wait_seconds=60)

    if msg:
        now = datetime.now(UTC)
        patient_msg = Message(record_id=record_id, role="patient", content=msg, created_at=now)
        db.add(patient_msg)
        db.commit()
        db.refresh(patient_msg)
        update_initiative_timer(record_id, request.app.state.initiative_cache, len(msg))
        return {"triggered": True, "message": msg, "id": patient_msg.id}

    return {"triggered": False, "message": None}


@router.get("/{record_id}/emotion/history")
def get_emotion_history(
    record_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    request: Request,
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if record.user_id != current_user.id and not current_user.has_permission("score_review"):
        raise HTTPException(status_code=403, detail="无权限")
    emotion = get_emotion(record_id, request.app.state.emotion_cache)
    return {"history": getattr(emotion, "history", [])}


@router.get("/{record_id}/initiative/history")
def get_initiative_history(
    record_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if record.user_id != current_user.id and not current_user.has_permission("score_review"):
        raise HTTPException(status_code=403, detail="无权限")
    msgs = (
        db.query(Message)
        .filter(
            Message.record_id == record_id,
            Message.role == "patient",
        )
        .order_by(Message.created_at.desc())
        .limit(20)
        .all()
    )
    return {"history": [{"id": m.id, "content": m.content, "created_at": m.created_at.isoformat()} for m in msgs]}


@router.post("/{record_id}/exam/{op_type}")
def perform_exam(
    record_id: int,
    op_type: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    request: Request,
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能操作自己的训练")
    if record.status != "in_progress":
        raise HTTPException(status_code=400, detail="训练已结束")

    case = db.query(Case).filter(Case.id == record.case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")

    result = handle_operation(op_type, case.case_data or {})

    snapshot = record.practice_snapshot or {}
    exam_results = snapshot.get("_exam_results", [])
    if not isinstance(exam_results, list):
        exam_results = []
    exam_results.append(
        {
            "type": op_type,
            "label": result.get("label", ""),
            "value": str(result.get("value", "")),
            "unit": result.get("unit", ""),
        }
    )
    snapshot["_exam_results"] = exam_results
    record.practice_snapshot = snapshot

    msg = Message(
        record_id=record_id,
        role="system",
        content=f"{result.get('label', '')}: {result.get('value', '')}{result.get('unit', '')}",
    )
    db.add(msg)

    features = resolve_features(record.practice_snapshot)
    if features.get("exam_emotion_bridge") and features.get("emotion"):
        from contexts.training.pipeline.plugin import run_plugin_hooks

        last_student_msg = (
            db.query(Message)
            .filter(Message.record_id == record_id, Message.role == "student")
            .order_by(Message.created_at.desc())
            .first()
        )
        explained = bool(last_student_msg and _has_explanation(last_student_msg.content))
        exam_count = len(exam_results)
        hook_ctx = {
            "record": record,
            "emotion_cache": request.app.state.emotion_cache,
            "initiative_cache": request.app.state.initiative_cache,
            "op_type": op_type,
            "explanation_given": explained,
            "exam_count": exam_count,
        }
        run_plugin_hooks("on_exam", hook_ctx, features)

    db.commit()
    return {"type": op_type, "data": result, "all_results": exam_results}


def _has_explanation(text: str) -> bool:
    keywords = ["因为", "所以", "给你", "检查一下", "评估", "需要了解", "测量一下", "看一下", "查一下"]
    return any(kw in text for kw in keywords)
