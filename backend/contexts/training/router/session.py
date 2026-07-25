import asyncio
import logging
import threading
from copy import deepcopy
from datetime import UTC, datetime
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session, joinedload

from core.database import get_db
from core.datetime_utils import ensure_utc, parse_iso_datetime
from core.exceptions import AuthError, NotFoundError
from core.pagination import paginate
from core.security import get_current_user, load_role_permissions, require_permission
from infrastructure.llm import LogWorker, ProfileRouter
from contexts.training.capabilities import detect_capabilities
from models import (
    Assignment,
    Case,
    CaseQuestionnaire,
    LLMCallLog,
    Message,
    NursingRecord,
    QuestionnaireResponse,
    Score,
    ScoreReview,
    ScoringProgress,
    TrainingRecord,
    TrainingSessionState,
    User,
    UserClass,
    VoiceCallLog,
)
from profiles.registry import get_profile
from schemas import (
    DeleteResponse,
    OkResponse,
    PaginatedResponse,
    ScoreItem,
    ScoreReviewItem,
    TrainingRecordBrief,
    TrainingRecordDetail,
    TrainingStartRequest,
    TrainingStartResponse,
)
from schemas.case_schema import normalize_gender, validate_case_data

log = logging.getLogger(__name__)

router = APIRouter()


def _cascade_delete_training_record(db: Session, record_id: int) -> None:
    """Delete all related data for a training record in correct order."""
    tables = [
        (Message, Message.record_id),
        (Score, Score.record_id),
        (LLMCallLog, LLMCallLog.record_id),
        (NursingRecord, NursingRecord.record_id),
        (VoiceCallLog, VoiceCallLog.record_id),
        (TrainingSessionState, TrainingSessionState.record_id),
        (ScoringProgress, ScoringProgress.record_id),
    ]
    for model, column in tables:
        db.query(model).filter(column == record_id).delete(synchronize_session="fetch")


_infra_client: httpx.AsyncClient | None = None
_infra_router: ProfileRouter | None = None
_infra_log_worker: LogWorker | None = None
_main_loop: asyncio.AbstractEventLoop | None = None
_background_thread: threading.Thread | None = None
_loop_lock = threading.Lock()


def _ensure_loop():
    global _main_loop, _background_thread
    with _loop_lock:
        if _main_loop is None or _main_loop.is_closed():
            _main_loop = asyncio.new_event_loop()
            _background_thread = threading.Thread(target=_main_loop.run_forever, daemon=False)
            _background_thread.start()
    return _main_loop


def set_training_infra(client, router_obj, log_worker, background_loop=None):
    global _infra_client, _infra_router, _infra_log_worker, _main_loop
    _infra_client = client
    _infra_router = router_obj
    _infra_log_worker = log_worker
    if background_loop is not None:
        _main_loop = background_loop


def stop_background_loop():
    global _main_loop, _background_thread
    if _main_loop is not None and not _main_loop.is_closed():
        _main_loop.call_soon_threadsafe(_main_loop.stop)
    if _background_thread is not None and _background_thread.is_alive():
        _background_thread.join(timeout=10)
    _main_loop = None
    _background_thread = None


def _get_client():
    if _infra_client is None:
        raise RuntimeError("Training infra not initialized")
    return _infra_client


def _get_router():
    if _infra_router is None:
        raise RuntimeError("Training infra not initialized")
    return _infra_router


def _get_log_worker():
    if _infra_log_worker is None:
        raise RuntimeError("Training infra not initialized")
    return _infra_log_worker


def _schedule_background(coro):
    try:
        loop = asyncio.get_running_loop()
        return loop.create_task(coro)
    except RuntimeError:
        loop = _ensure_loop()
        return asyncio.run_coroutine_threadsafe(coro, loop)


def _count_pending_questionnaires(db: Session, case_id: int) -> int:
    """病例下「必做」问卷的数量（供训练开始/详情响应提示用）。"""
    return (
        db.query(CaseQuestionnaire)
        .filter(CaseQuestionnaire.case_id == case_id, CaseQuestionnaire.is_required == True)
        .count()
    )


def _build_config(features: dict | None = None, time_limit_minutes: int | None = None) -> dict:
    return {
        "id": 0,
        "name": "自定义配置",
        "features": features or {},
        "behavior": {"time_limit_minutes": time_limit_minutes} if time_limit_minutes else {},
    }


def _extract_vitals(case_data: dict, training_type: str) -> dict:
    """Extract initial vital signs for scene state seeding.

    Triage cases have a flat top-level ``vitals`` dict. History-taking
    cases store ranges inside ``exam_anchors.vital_signs`` which are
    resolved to midpoint numeric values.
    """
    if training_type != "history_taking":
        return case_data.get("vitals", {})

    vital_signs = (case_data.get("exam_anchors") or {}).get("vital_signs") or {}
    if not isinstance(vital_signs, dict):
        return {}

    result: dict[str, float | int | None] = {}

    temp = vital_signs.get("temperature")
    if temp:
        result["temp"] = _resolve_vital_num(str(temp))

    hr = vital_signs.get("heart_rate")
    if hr:
        result["hr"] = int(_resolve_vital_num(str(hr)))

    bp = vital_signs.get("blood_pressure")
    if bp:
        try:
            left, _right = str(bp).split("-", 1)
            s, d = left.split("/")
            result["bp_sys"] = int(float(s))
            result["bp_dia"] = int(float(d))
        except (ValueError, IndexError):
            pass

    rr = vital_signs.get("respiratory_rate")
    if rr:
        result["rr"] = int(_resolve_vital_num(str(rr)))

    spo2 = vital_signs.get("spo2")
    if spo2:
        result["spo2"] = _resolve_vital_num(str(spo2))

    pain = vital_signs.get("pain_score")
    if pain is not None:
        try:
            result["pain"] = int(float(str(pain).split("-")[0].strip()))
        except (ValueError, IndexError):
            pass

    return result


def _resolve_vital_num(raw: str) -> float:
    """Resolve a range string like ``"36.8-37.2"`` → midpoint ``36.9``."""
    raw = raw.strip()
    if "-" in raw:
        try:
            lo, hi = raw.split("-", 1)
            return (float(lo) + float(hi)) / 2
        except (ValueError, IndexError):
            pass
    try:
        return float(raw)
    except ValueError:
        return 0.0


def _load_nursing_sheet(db: Session, record_id: int) -> dict | None:
    """Load the saved nursing record sheet for display on record detail."""
    nr = db.query(NursingRecord).filter(NursingRecord.record_id == record_id).first()
    if not nr or not nr.sheet_data:
        return None
    if isinstance(nr.sheet_data, dict):
        return dict(nr.sheet_data)
    return None


def _create_record(
    db: Session,
    user_id: int,
    case: Case,
    case_data: dict,
    config: dict,
    *,
    assignment_id: str | None = None,
    is_overdue: bool = False,
    app_state=None,
):
    training_type = case.training_type or "history_taking"

    time_limit = config.get("behavior", {}).get("time_limit_minutes") or case.time_limit_minutes or 20
    time_limit = max(5, min(120, int(time_limit)))

    config["features"] = config.get("features") or {}
    validate_case_data(training_type, case_data, strict=False)

    record = TrainingRecord(
        user_id=user_id,
        case_id=case.id,
        practice_snapshot=config or None,
        assignment_id=assignment_id,
        is_overdue=is_overdue,
        training_type=training_type,
        status="in_progress",
        time_limit=time_limit,
    )

    user = db.query(User).filter(User.id == user_id).first()
    if user:
        user_perms = load_role_permissions(db, user.role_id)
        if "case_manage" in user_perms or "score_review" in user_perms:
            record.is_test = True

    db.add(record)
    db.flush()

    record.case_snapshot = deepcopy(case_data)
    profile = get_profile(training_type)
    resolved_features = detect_capabilities(
        case_data=case_data,
        training_type=training_type,
        overrides=(record.practice_snapshot or {}).get("features"),
    )
    from contexts.training.rubric_builder import build_final_rubric

    record.rubric_snapshot = build_final_rubric(profile.rubric, resolved_features)
    record.prompt_snapshot = {
        "system": profile.prompts.system,
        "dynamic": profile.prompts.dynamic,
    }

    patient_info = case_data.get("patient_info", {})
    patient_name = patient_info.get("name", "患者")
    opening_line = case_data.get("opening_line", "我今天感觉不太舒服，所以来看看。")
    greeting = f"你好，我是{patient_name}。{opening_line}"

    greeting_msg = Message(record_id=record.id, role="patient", content=greeting)
    db.add(greeting_msg)

    # D-1：播种 scene 初始状态（从病例数据派生，供前端 MonitorCard/SceneRenderer 消费）
    patient_info = case_data.get("patient_info", {})
    vitals = _extract_vitals(case_data, training_type)
    record.runtime_state = {
        "scene": {
            "environment": {
                "type": "ward" if training_type in ("history_taking",) else "er",
                "time_of_day": "day",
                "equipment": [],
            },
            "patient": {
                "position": "semi-recumbent",
                "consciousness": "alert",
                "visible_symptoms": patient_info.get("visible_symptoms", []),
                "expression": patient_info.get("expression", "neutral"),
            },
            "vitals": {
                "hr": vitals.get("hr"),
                "bp_sys": vitals.get("bp_sys"),
                "bp_dia": vitals.get("bp_dia"),
                "spo2": vitals.get("spo2"),
                "rr": vitals.get("rr"),
                "temp": vitals.get("temp"),
                "pain": vitals.get("pain"),
            },
        }
    }

    snapshot = record.practice_snapshot or {}
    snapshot["features"] = resolved_features
    record.practice_snapshot = snapshot
    if app_state is not None and resolved_features.get("patient_initiative"):
        from profiles.history_taking.initiative import update_initiative_timer

        update_initiative_timer(record.id, app_state.initiative_cache, db)

    db.commit()
    return record, greeting


@router.post("/start", response_model=TrainingStartResponse)
def start_training(
    req: TrainingStartRequest,
    current_user: Annotated[User, Depends(require_permission("training_access"))],
    db: Annotated[Session, Depends(get_db)],
    request: Request,
):
    case = db.query(Case).filter(Case.id == req.case_id).first()
    if not case:
        raise NotFoundError(detail="病例不存在")
    if not case.is_open:
        raise AuthError(detail="该病例暂未开放", status_code=403)

    config = _build_config(req.features, req.time_limit_minutes)

    record, greeting = _create_record(
        db,
        current_user.id,
        case,
        case.case_data or {},
        config,
        app_state=request.app.state,
    )

    log.info(
        f"训练开始: record_id={record.id} case_id={case.id} case_name={case.name}",
        extra={
            "user_id": current_user.id,
            "user_role": current_user.role.name if current_user.role else "",
            "action": "training_start",
        },
    )
    pending_questionnaires = _count_pending_questionnaires(db, case.id)

    return TrainingStartResponse(
        record_id=record.id,
        greeting=greeting,
        case_name=case.name,
        pending_questionnaires=pending_questionnaires,
    )


@router.post("/start-from-assignment", response_model=TrainingStartResponse)
def start_training_from_assignment(
    current_user: Annotated[User, Depends(require_permission("training_access"))],
    db: Annotated[Session, Depends(get_db)],
    request: Request,
    assignment_id: str = Query(...),
):
    assignment = (
        db.query(Assignment).options(joinedload(Assignment.case)).filter(Assignment.id == assignment_id).first()
    )
    if not assignment:
        raise NotFoundError(detail="练习发布不存在")

    if assignment.is_closed:
        raise HTTPException(status_code=400, detail="该作业已被教师关闭")

    now = datetime.now(UTC)
    if assignment.start_time and now < ensure_utc(assignment.start_time):
        raise HTTPException(status_code=400, detail="该作业尚未开始，请在开放时间后再试")

    is_overdue = now > ensure_utc(assignment.end_time)

    user_class = (
        db.query(UserClass)
        .filter(
            UserClass.user_id == current_user.id,
            UserClass.class_id == assignment.class_id,
        )
        .first()
    )
    if not user_class:
        raise AuthError(detail="你不在该练习的目标班级中", status_code=403)

    if assignment.student_ids is not None and current_user.id not in assignment.student_ids:
        raise AuthError(detail="你不在该作业的指定学生名单中", status_code=403)

    attempt_count = (
        db.query(TrainingRecord)
        .filter(
            TrainingRecord.user_id == current_user.id,
            TrainingRecord.assignment_id == assignment.id,
            TrainingRecord.is_test == False,
            TrainingRecord.status != "in_progress",
        )
        .count()
    )

    if assignment.max_attempts and assignment.max_attempts > 0 and attempt_count >= assignment.max_attempts:
        raise HTTPException(status_code=400, detail="已达到最大尝试次数，无法开始新训练")

    existing = (
        db.query(TrainingRecord)
        .filter(
            TrainingRecord.user_id == current_user.id,
            TrainingRecord.assignment_id == assignment.id,
            TrainingRecord.status == "in_progress",
            TrainingRecord.is_test == False,
        )
        .first()
    )
    if existing:
        case = assignment.case
        case_data = case.case_data if case else {}
        patient_info = case_data.get("patient_info", {})
        patient_name = patient_info.get("name", "患者")
        greeting = f"你好，我是{patient_name}。{case_data.get('opening_line', '我今天感觉不太舒服，所以来看看。')}"
        return TrainingStartResponse(
            record_id=existing.id,
            greeting=greeting,
            case_name=case.name if case else "",
            pending_questionnaires=_count_pending_questionnaires(db, case.id if case else 0),
        )

    if is_overdue:
        raise HTTPException(status_code=400, detail="该作业已过期，无法开始新训练")

    case = assignment.case
    if not case:
        raise NotFoundError(detail="病例不存在")

    config = {
        "id": 0,
        "name": case.name,
        "features": assignment.features or {},
        "behavior": assignment.behavior or {},
    }

    record, greeting = _create_record(
        db,
        current_user.id,
        case,
        case.case_data or {},
        config,
        assignment_id=assignment.id,
        is_overdue=is_overdue,
        app_state=request.app.state,
    )

    log.info(
        f"Assignment training start: assignment_id={assignment.id} record_id={record.id}",
        extra={"user_id": current_user.id, "action": "assignment_start"},
    )
    return TrainingStartResponse(
        record_id=record.id,
        greeting=greeting,
        case_name=case.name,
        pending_questionnaires=_count_pending_questionnaires(db, case.id),
    )


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
    training_type: Annotated[str | None, Query(description="按训练类型筛选(history_taking/triage)")] = None,
    exclude_is_test: Annotated[bool, Query(description="排除试跑记录")] = True,
):
    base = db.query(TrainingRecord)

    if not current_user.has_permission("score_review"):
        base = base.filter(TrainingRecord.user_id == current_user.id)
    else:
        if student_name:
            base = base.filter(TrainingRecord.user.has(User.display_name.ilike(f"%{student_name}%")))
        if case_id is not None:
            base = base.filter(TrainingRecord.case_id == case_id)
        if class_id is not None:
            base = base.join(UserClass, UserClass.user_id == TrainingRecord.user_id).filter(
                UserClass.class_id == class_id
            )

    if training_type:
        base = base.filter(TrainingRecord.training_type == training_type)
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
    remaining_seconds = None
    if record.status == "in_progress" and record.start_time:
        elapsed = (datetime.now(UTC) - ensure_utc(record.start_time)).total_seconds()
        remaining_seconds = max(0, int(time_limit * 60 - elapsed))
    patient_info = case_data.get("patient_info", {})

    profile_info = {}
    try:
        p = get_profile(record.training_type or "history_taking")
        profile_info = {"type": p.name, "label": "病史采集" if p.name == "history_taking" else "预检分诊"}
    except KeyError:
        pass

    # 继续训练：回填服务器端持久化的情绪(信赖/舒适/状态)与主动追问计数。
    session_state = db.query(TrainingSessionState).filter(TrainingSessionState.record_id == record_id).first()
    emotion = None
    initiative_count = 0
    if session_state is not None:
        es_dict = session_state.emotion_state
        if isinstance(es_dict, dict) and "trust" in es_dict:
            from profiles.history_taking.emotion import EmotionState

            es = EmotionState.from_dict(es_dict)
            emotion = {"trust": es.trust, "comfort": es.comfort, "state": es.state}
        initiative_count = session_state.initiative_count or 0

    case_title = case_data.get("title", "") or (case.name if case else "")

    personality_dict = case_data.get("personality", {})
    personality_parts = []
    if personality_dict.get("health_literacy"):
        personality_parts.append(
            {"low": "低素养", "normal": "中等", "high": "高素养"}.get(personality_dict["health_literacy"], "")
        )
    if personality_dict.get("verbosity"):
        personality_parts.append(
            {"terse": "寡言", "normal": "正常", "verbose": "絮叨"}.get(personality_dict["verbosity"], "")
        )
    personality_label = "·".join(filter(None, personality_parts))

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
        required_inquiries=case_data.get("required_inquiries", []),
        patient_info=patient_info,
        patient_gender=normalize_gender(patient_info.get("gender", "")),
        training_type=record.training_type or "history_taking",
        features=detect_capabilities(
            case_data=case_data,
            training_type=record.training_type or "history_taking",
            overrides=(record.practice_snapshot or {}).get("features"),
        ),
        patient_name=patient_info.get("name", ""),
        patient_age=patient_info.get("age", 0),
        chief_complaint=case_data.get("chief_complaint", ""),
        personality=personality_label,
        case_title=case_title,
        from_assignment=record.assignment_id is not None,
        pending_questionnaires=pending_questionnaires,
        exam_anchors=case_data.get("exam_anchors", {}),
        exam_results=dict(record.runtime_state or {}).get("exam_results", []),
        triage_result=dict(record.runtime_state or {}).get("triage_result", {}),
        nursing_record_sheet=_load_nursing_sheet(db, record.id),
        case_data=case_data,
        profile_info=profile_info,
        emotion=emotion,
        initiative_count=initiative_count,
        is_test=record.is_test,
    )


@router.delete("/records/{record_id}", response_model=DeleteResponse)
def delete_record(
    record_id: int, current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise NotFoundError(detail="训练记录不存在")

    if not current_user.has_permission("score_review") and record.user_id != current_user.id:
        raise AuthError(detail="无权删除此记录", status_code=403)

    try:
        _cascade_delete_training_record(db, record_id)
        db.query(QuestionnaireResponse).filter(QuestionnaireResponse.record_id == record_id).update(
            {QuestionnaireResponse.record_id: None}, synchronize_session="fetch"
        )
        db.delete(record)
        db.commit()
    except Exception as e:
        db.rollback()
        log.error(f"删除训练记录失败: record_id={record_id} error={e}")
        raise HTTPException(status_code=500, detail="删除训练记录失败，请稍后重试")

    log.info(
        f"训练记录删除: record_id={record_id} case_id={record.case_id} owner_id={record.user_id}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )
    return {"message": "训练记录已删除"}


@router.put("/records/{record_id}/abandon", response_model=OkResponse)
def abandon_record(
    record_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise NotFoundError(detail="训练记录不存在")
    if not current_user.has_permission("score_review") and record.user_id != current_user.id:
        raise AuthError(detail="无权操作此记录", status_code=403)
    if record.status != "in_progress":
        raise HTTPException(status_code=400, detail="只能放弃进行中的训练")

    record.status = "abandoned"
    record.end_time = datetime.now(UTC)
    db.query(TrainingSessionState).filter(TrainingSessionState.record_id == record_id).delete()
    db.commit()

    log.info(
        f"训练记录放弃: record_id={record_id}",
        extra={"user_id": current_user.id, "action": "training_abandon"},
    )
    return {"message": "训练记录已放弃"}
