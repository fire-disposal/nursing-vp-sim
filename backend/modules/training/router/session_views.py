import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from core.database import get_db
from core.datetime_utils import ensure_utc, parse_iso_datetime
from core.exceptions import AuthError, NotFoundError
from core.pagination import paginate
from core.security import get_current_user
from models import (
    ScoreReview,
    TrainingRecord,
    TrainingSessionState,
    TrainingToolRequest,
    User,
    UserClass,
)
from modules.training.capabilities import detect_capabilities
from schemas import (
    PaginatedResponse,
    PatientPublicInfo,
    ScoreItem,
    ScoreReviewItem,
    TrainingRecordBrief,
    TrainingRecordDetail,
)
from schemas.case_schema import normalize_gender

from .session import (
    _count_pending_questionnaires,
    _load_nursing_sheet,
    _public_patient_info,
    _public_scene,
)

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/records", response_model=PaginatedResponse[TrainingRecordBrief])
def get_records(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    student_name: Annotated[str | None, Query(description="按学生姓名模糊搜索")] = None,
    case_id: Annotated[int | None, Query(description="按病例ID筛选")] = None,
    status: Annotated[str | None, Query(description="按状态筛选(in_progress/completed)")] = None,
    date_from: Annotated[str | None, Query(description="开始日期 ISO 格式 (含)")] = None,
    date_to: Annotated[str | None, Query(description="结束日期 ISO 格式 (含)")] = None,
    class_id: Annotated[int | None, Query()] = None,
    training_type: Annotated[str | None, Query(description="按训练类型筛选(history_taking)")] = None,
    user_id: Annotated[int | None, Query(description="按用户ID筛选（仅 score_review 权限生效）")] = None,
    exclude_is_test: Annotated[bool, Query(description="排除试跑记录")] = True,
):

    base = db.query(TrainingRecord)

    if not current_user.has_permission("score_review"):
        base = base.filter(TrainingRecord.user_id == current_user.id)
    else:
        if user_id is not None:
            base = base.filter(TrainingRecord.user_id == user_id)
        if student_name:
            base = base.filter(TrainingRecord.user.has(User.display_name.ilike(f"%{student_name}%")))
        if case_id is not None:
            base = base.filter(TrainingRecord.case_id == case_id)
        if class_id is not None:
            base = base.join(UserClass, UserClass.user_id == TrainingRecord.user_id).filter(
                UserClass.class_id == class_id
            )
    base = base.filter(TrainingRecord.training_type == "history_taking")
    if exclude_is_test:
        base = base.filter(TrainingRecord.is_test == False)

    if status:
        base = base.filter(TrainingRecord.status == status)
    if date_from:
        try:
            df = parse_iso_datetime(date_from)
            base = base.filter(TrainingRecord.start_time >= df)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"无效日期格式: {date_from}")
    if date_to:
        try:
            dt = parse_iso_datetime(date_to)
            base = base.filter(TrainingRecord.start_time <= dt)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"无效日期格式: {date_to}")

    query = base.options(
        joinedload(TrainingRecord.case),
        joinedload(TrainingRecord.user),
        joinedload(TrainingRecord.score),
        joinedload(TrainingRecord.assignment),
    ).order_by(TrainingRecord.start_time.desc())

    records, total = paginate(query, offset, limit)

    items = [
        TrainingRecordBrief(
            id=r.id,
            case_id=r.case_id,
            case_name=r.case.name if r.case else "",
            training_type=r.training_type or "history_taking",
            user_display_name=r.user.display_name if r.user else "",
            user_student_id=r.user.student_id if r.user else None,
            status=r.status,
            start_time=r.start_time,
            end_time=r.end_time,
            score_total=r.score.total_score if r.score else None,
            scoring_status=r.scoring_status,
            scoring_error=r.scoring_error,
            is_test=r.is_test,
            assignment_id=r.assignment_id,
            assignment_title=r.assignment.title if r.assignment else None,
        )
        for r in records
    ]
    return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)


@router.get("/records/{record_id}", response_model=TrainingRecordDetail)
def get_record_detail(
    record_id: int, current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]
):
    record = (
        db.query(TrainingRecord)
        .options(
            joinedload(TrainingRecord.case),
            joinedload(TrainingRecord.user),
            joinedload(TrainingRecord.score),
            joinedload(TrainingRecord.messages),
        )
        .filter(TrainingRecord.id == record_id)
        .first()
    )
    if not record:
        raise NotFoundError(detail="记录不存在")

    if not current_user.has_permission("score_review") and record.user_id != current_user.id:
        raise AuthError(detail="无权查看此记录", status_code=403)

    case = record.case
    user = record.user
    score = record.score
    score_obj = None
    if score:
        score_obj = ScoreItem.model_validate(score)
        latest_review = (
            db.query(ScoreReview)
            .filter(ScoreReview.score_id == score.id)
            .order_by(ScoreReview.created_at.desc())
            .first()
        )
        if latest_review:
            score_obj.review = ScoreReviewItem(
                detail_scores=latest_review.detail_scores,
                total_score=latest_review.total_score,
                comment=latest_review.comment,
                reviewed_at=latest_review.created_at,
            )
    pending_questionnaires = _count_pending_questionnaires(db, case.id) if case is not None else 0

    case_data = record.case_snapshot or (case.case_data or {} if case else {})
    time_limit = record.time_limit or 20
    remaining_seconds = time_limit * 60  # 尚未開始互動，顯示全額時間
    if record.status == "in_progress" and record.timer_started_at:
        elapsed = (datetime.now(UTC) - ensure_utc(record.timer_started_at)).total_seconds()
        remaining_seconds = max(0, int(time_limit * 60 - elapsed))
    patient_info = _public_patient_info(case_data)
    case_title = case_data.get("title", "") or (case.name if case else "")

    # 继续训练：回填服务器端持久化的情绪(信赖/舒适/状态)与主动追问计数。
    session_state = db.query(TrainingSessionState).filter(TrainingSessionState.record_id == record_id).first()
    emotion = None
    initiative_count = 0
    if session_state is not None:
        # 优先读 4D 新表
        from modules.training.patient_ai.emotion import EmotionRepository

        repo = EmotionRepository()
        es = repo.get(record_id, db)
        if es is not None:
            emotion = {
                "trust": round(es.vector.trust * 100),
                "comfort": round((1.0 - es.vector.anxiety * 0.5 - es.vector.irritation * 0.5) * 100),
                "anxiety": round(es.vector.anxiety * 100),
                "irritation": round(es.vector.irritation * 100),
                "cooperation": round(es.vector.cooperation * 100),
                "state": "neutral",  # deprecated; use 4D fields
            }
        initiative_count = session_state.initiative_count or 0
    correction_raw = dict(record.runtime_state or {}).get("message_correction")
    correction_state = correction_raw if isinstance(correction_raw, dict) else {}
    correction_limit = int(correction_state.get("limit") or 3)
    correction_used = max(0, int(correction_state.get("used") or 0))
    eligible_last_message_id = None
    if (
        record.status == "in_progress"
        and record.scoring_status not in {"pending", "processing", "completed"}
        and score is None
        and correction_used < correction_limit
    ):
        ordered_messages = list(record.messages or [])
        patient = ordered_messages[-1] if ordered_messages and ordered_messages[-1].role == "patient" else None
        student_idx = len(ordered_messages) - 2 if patient is not None else len(ordered_messages) - 1
        if student_idx >= 0 and ordered_messages[student_idx].role == "student":
            student = ordered_messages[student_idx]
            mutation = (
                db.query(TrainingToolRequest.id)
                .filter(
                    TrainingToolRequest.record_id == record.id,
                    TrainingToolRequest.action != "load",
                    TrainingToolRequest.created_at > student.created_at,
                )
                .first()
            )
            if mutation is None:
                eligible_last_message_id = student.id

    return TrainingRecordDetail(
        id=record.id,
        case_id=record.case_id,
        case_name=case.name if case else "",
        user_display_name=user.display_name if user else "",
        status=record.status,
        scoring_status=record.scoring_status,
        scoring_error=record.scoring_error,
        start_time=record.start_time,
        end_time=record.end_time,
        time_limit=time_limit,
        remaining_seconds=remaining_seconds,
        messages=record.messages,  # ty: ignore[invalid-argument-type]
        score=score_obj,
        patient_info=PatientPublicInfo.model_validate(patient_info),
        patient_gender=normalize_gender(str(patient_info.get("gender") or "")) or "",
        training_type=record.training_type or "history_taking",
        features=detect_capabilities(
            case_data=case_data,
            training_type=record.training_type or "history_taking",
            overrides=(record.practice_snapshot or {}).get("features"),
        ),
        patient_name=patient_info["name"],
        patient_age=patient_info["age"],
        chief_complaint=case_data.get("chief_complaint", ""),
        case_title=case_title,
        from_assignment=record.assignment_id is not None,
        pending_questionnaires=pending_questionnaires,
        exam_results=dict(record.runtime_state or {}).get("exam_results", []),
        scene=_public_scene(record),
        nursing_record_sheet=_load_nursing_sheet(db, record.id),
        emotion=emotion,
        initiative_count=initiative_count,
        message_correction={
            "used": correction_used,
            "limit": correction_limit,
            "remaining": max(0, correction_limit - correction_used),
            "eligible_last_message_id": eligible_last_message_id,
        },
        required_inquiries=case_data.get("required_inquiries", []),
        is_test=record.is_test,
    )

