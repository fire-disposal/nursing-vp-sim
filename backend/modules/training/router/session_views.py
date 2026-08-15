import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from core.database import get_db
from core.datetime_utils import parse_iso_datetime
from core.exceptions import AuthError, NotFoundError
from core.pagination import paginate
from core.security import get_current_user
from core.statuses import ScoringStatus, TrainingMode, TrainingStatus, normalize_training_mode
from models import (
    Assignment,
    Case,
    Score,
    ScoreReview,
    TrainingAction,
    TrainingRecord,
    TrainingSessionState,
    User,
    UserClass,
)
from modules.training.capabilities import detect_capabilities
from modules.training.timing import remaining_seconds as compute_remaining_seconds
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


def _hidden_case(record: TrainingRecord) -> str | None:
    """训练期间隐藏病例身份的占位文案；未隐藏或已结束返回 None。

    触发源二选一：自主盲盒（mode=blind_box，随机病例）或作业隐藏开关
    （behavior.hide_case_info，教师指定病例）。结束后揭示以便复盘。
    """
    behavior = (record.practice_snapshot or {}).get("behavior", {}) or {}
    mode = normalize_training_mode(behavior.get("mode"))
    if mode == TrainingMode.BLIND_BOX.value:
        placeholder = "盲盒训练"
    elif bool(behavior.get("hide_case_info")):
        placeholder = "隐藏病例练习"
    else:
        return None
    return placeholder if record.status == TrainingStatus.IN_PROGRESS else None


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
    sort_by: Annotated[str, Query(description="排序字段：start_time/score_total/duration")] = "start_time",
    order: Annotated[str, Query(description="排序方向：asc/desc")] = "desc",
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

    # 查询裁剪：列表只需少量字段，避免整行 case_data/Score JSONB 灌入内存
    query = base.options(
        joinedload(TrainingRecord.case).load_only(Case.id, Case.name),
        joinedload(TrainingRecord.user).load_only(User.id, User.display_name, User.student_id),
        joinedload(TrainingRecord.score).load_only(Score.id, Score.total_score),
        joinedload(TrainingRecord.assignment).load_only(Assignment.id, Assignment.title),
    )

    # 服务端排序（教师页按分数/时长排序需全局正确，不能只排当前页）
    desc = order != "asc"
    if sort_by == "score_total":
        sort_col = Score.total_score
    elif sort_by == "duration":
        sort_col = TrainingRecord.end_time - TrainingRecord.start_time
    else:
        sort_col = TrainingRecord.start_time
    # 空值（未评分/未结束）排最后
    query = query.order_by(sort_col.is_(None), sort_col.desc() if desc else sort_col.asc())

    records, total = paginate(query, offset, limit)

    # 复核存在性：单次查询，避免对每行 reviews 集合的 N+1 / joinedload 分页陷阱
    score_ids = [r.score.id for r in records if r.score]
    reviewed_map: set[int] = set()
    if score_ids:
        reviewed_map = {
            row[0] for row in db.query(ScoreReview.score_id).filter(ScoreReview.score_id.in_(score_ids)).all()
        }

    items = [
        TrainingRecordBrief(
            id=r.id,
            case_id=r.case_id,
            case_name=_hidden_case(r) or (r.case.name if r.case else ""),
            training_type=r.training_type or "history_taking",
            user_id=r.user_id,
            user_display_name=r.user.display_name if r.user else "",
            user_student_id=r.user.student_id if r.user else None,
            score_reviewed=bool(r.score and r.score.id in reviewed_map),
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


@router.get("/records/{record_id}/emotion-events")
def get_emotion_events(
    record_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """情绪事件历史（批次 A-3 轨迹图数据源）：按序返回事件 + 4D 状态快照。

    前端据此绘制 trust/anxiety/irritation/cooperation 轨迹与事件标注。
    """
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise NotFoundError(detail="记录不存在")
    if not current_user.has_permission("score_review") and record.user_id != current_user.id:
        raise AuthError(detail="无权查看此记录", status_code=403)

    from models import TrainingSessionEmotionEvent

    rows = (
        db.query(TrainingSessionEmotionEvent)
        .filter(TrainingSessionEmotionEvent.record_id == record_id)
        .order_by(TrainingSessionEmotionEvent.created_at.asc(), TrainingSessionEmotionEvent.id.asc())
        .all()
    )
    events = []
    for r in rows:
        after = r.after_state or {}
        events.append(
            {
                "turn_id": r.turn_id,
                "event_type": r.event_type,
                "confidence": r.confidence,
                "evidence": r.evidence,
                "delta": r.delta or {},
                "after_state": {
                    "trust": round(after.get("trust", 0) * 100),
                    "anxiety": round(after.get("anxiety", 0) * 100),
                    "irritation": round(after.get("irritation", 0) * 100),
                    "cooperation": round(after.get("cooperation", 0) * 100),
                },
            }
        )
    return {"events": events}


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
            # 顶层复核信息：让详情响应一次携带全部复核数据，
            # 前端无需再发 GET /review 消除串行瀑布。
            reviewer = (
                db.query(User).filter(User.id == latest_review.reviewed_by).first()
                if latest_review.reviewed_by
                else None
            )
            score_obj.review_status = "reviewed"
            score_obj.reviewed_by_name = reviewer.display_name if reviewer else None
            score_obj.reviewed_at = latest_review.created_at
            score_obj.review_comment = latest_review.comment
    pending_questionnaires = _count_pending_questionnaires(db, case.id) if case is not None else 0

    case_data = record.case_snapshot or (case.case_data or {} if case else {})
    time_limit = record.time_limit or 20
    remaining_seconds = compute_remaining_seconds(record)
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
            from modules.training.patient_ai.emotion.renderer import serialize_emotion_vector

            emotion = serialize_emotion_vector(es.vector)
        initiative_count = session_state.initiative_count or 0
    correction_raw = dict(record.runtime_state or {}).get("message_correction")
    correction_state = correction_raw if isinstance(correction_raw, dict) else {}
    correction_limit = int(correction_state.get("limit") or 3)
    correction_used = max(0, int(correction_state.get("used") or 0))
    eligible_last_message_id = None
    if (
        record.status == TrainingStatus.IN_PROGRESS
        and record.scoring_status not in {ScoringStatus.PENDING, ScoringStatus.PROCESSING, ScoringStatus.COMPLETED}
        and score is None
        and correction_used < correction_limit
    ):
        ordered_messages = list(record.messages or [])
        patient = ordered_messages[-1] if ordered_messages and ordered_messages[-1].role == "patient" else None
        student_idx = len(ordered_messages) - 2 if patient is not None else len(ordered_messages) - 1
        if student_idx >= 0 and ordered_messages[student_idx].role == "student":
            student = ordered_messages[student_idx]
            mutation = (
                db.query(TrainingAction.id)
                .filter(
                    TrainingAction.record_id == record.id,
                    TrainingAction.kind != "load",
                    TrainingAction.created_at > student.created_at,
                )
                .first()
            )
            if mutation is None:
                eligible_last_message_id = student.id

    hidden_placeholder = _hidden_case(record)
    mode = normalize_training_mode((record.practice_snapshot or {}).get("behavior", {}).get("mode"))
    # 隐藏时全量匿名（姓名/年龄/性别/主诉），避免 PatientInfoTool 等消费点泄露患者特征
    redacted_patient_info = {"name": "患者", "age": 0, "gender": ""}
    return TrainingRecordDetail(
        id=record.id,
        case_id=record.case_id,
        case_name=hidden_placeholder or (case.name if case else ""),
        user_display_name=user.display_name if user else "",
        status=record.status,
        scoring_status=record.scoring_status,
        scoring_error=record.scoring_error,
        start_time=record.start_time,
        end_time=record.end_time,
        time_limit=time_limit,
        remaining_seconds=remaining_seconds,
        mode=mode,
        hide_case_info=bool(hidden_placeholder),
        messages=record.messages,  # ty: ignore[invalid-argument-type]
        score=score_obj,
        patient_info=PatientPublicInfo.model_validate(redacted_patient_info if hidden_placeholder else patient_info),
        patient_gender="" if hidden_placeholder else normalize_gender(str(patient_info.get("gender") or "")) or "",
        training_type=record.training_type or "history_taking",
        features=detect_capabilities(
            case_data=case_data,
            training_type=record.training_type or "history_taking",
            overrides=(record.practice_snapshot or {}).get("features"),
        ),
        patient_name="患者" if hidden_placeholder else patient_info["name"],
        patient_age=0 if hidden_placeholder else patient_info["age"],
        chief_complaint="" if hidden_placeholder else case_data.get("chief_complaint", ""),
        case_title="" if hidden_placeholder else case_title,
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
        # 盲盒不显示引导内容（必问清单）；作业隐藏（hide_case_info）仅隐藏病例信息，引导保留
        required_inquiries=([] if mode == TrainingMode.BLIND_BOX.value else case_data.get("required_inquiries", [])),
        is_test=record.is_test,
    )
