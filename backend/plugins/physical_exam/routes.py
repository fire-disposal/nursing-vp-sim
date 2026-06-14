"""Physical exam routes — exam operation endpoint."""

import asyncio
import logging
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from contexts.patient import handle_operation
from core.database import get_db
from core.feature_flags import resolve_features
from core.security import get_current_user
from models import Case, Message, TrainingRecord, User
from plugins.base import ExamContext
from plugins.manager import get_plugin_manager

log = logging.getLogger(__name__)


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
        last_student_msg = (
            db.query(Message)
            .filter(Message.record_id == record_id, Message.role == "student")
            .order_by(Message.created_at.desc())
            .first()
        )
        explained = bool(last_student_msg and _has_explanation(last_student_msg.content))
        exam_count = len(exam_results)

        pm = get_plugin_manager()
        ctx = ExamContext(
            record=record,
            emotion_cache=request.app.state.emotion_cache,
            op_type=op_type,
            explanation_given=explained,
            exam_count=exam_count,
        )
        results = asyncio.run(pm.run_hook("on_exam", ctx, features))
        for effect in results:
            if effect is not None:
                if effect.snapshot_updates:
                    snap = record.practice_snapshot or {}
                    snap.update(effect.snapshot_updates)
                    record.practice_snapshot = snap

    db.commit()
    return {"type": op_type, "data": result, "all_results": exam_results}


def _has_explanation(text: str) -> bool:
    keywords = ["因为", "所以", "给你", "检查一下", "评估", "需要了解", "测量一下", "看一下", "查一下"]
    return any(kw in text for kw in keywords)
