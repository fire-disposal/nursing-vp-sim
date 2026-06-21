import asyncio
import logging
import threading
from datetime import UTC, datetime
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session, joinedload

from contexts.training.config_loader import get_config, list_configs
from core.capabilities import ALL_CAPABILITIES, resolve_features
from core.case_schema import normalize_gender, validate_case_data
from core.database import get_db
from core.datetime_utils import ensure_utc, parse_iso_datetime
from core.exceptions import AuthError, NotFoundError
from core.pagination import paginate
from core.security import get_current_user, require_permission
from infrastructure.llm import LogWorker, ProfileRouter
from infrastructure.prompt import PromptManager
from middleware.dependencies import resolve_school_filter
from models import (
    Assignment,
    Case,
    LLMCallLog,
    Message,
    Note,
    NursingRecord,
    Practice,
    QuestionnaireResponse,
    Score,
    TrainingRecord,
    User,
    UserClass,
)
from schemas import (
    DeleteResponse,
    PaginatedResponse,
    TrainingRecordBrief,
    TrainingRecordDetail,
    TrainingStartRequest,
    TrainingStartResponse,
)

log = logging.getLogger(__name__)

router = APIRouter()


async def _try_acquire_scoring(record_id: int, db) -> bool:
    """原子性地将 scoring_status 从 NULL 更新为 'pending'。

    用 DB 原子 UPDATE 代替内存锁，避免测试间状态泄漏，
    同时消除并发触发同一 record 评分的竞态。
    """
    from sqlalchemy import text

    result = db.execute(
        text("UPDATE training_records SET scoring_status = 'pending' WHERE id = :id AND scoring_status IS NULL"),
        {"id": record_id},
    )
    if result.rowcount > 0:
        from .scoring import _increment_scoring_generation

        _increment_scoring_generation(record_id)
    return result.rowcount > 0


_infra_client: httpx.AsyncClient | None = None
_infra_router: ProfileRouter | None = None
_infra_pm: PromptManager | None = None
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


def set_training_infra(client, router_obj, pm, log_worker, background_loop=None):
    global _infra_client, _infra_router, _infra_pm, _infra_log_worker, _main_loop
    _infra_client = client
    _infra_router = router_obj
    _infra_pm = pm
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


def _get_pm():
    if _infra_pm is None:
        raise RuntimeError("Training infra not initialized")
    return _infra_pm


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


def _resolve_features(case_data: dict, config: dict) -> dict:
    supported = case_data.get("supported_plugins", [])
    if not supported:
        return config
    if "features" not in config:
        return config
    features = config["features"]
    for pid in supported:
        if pid in ALL_CAPABILITIES:
            features.setdefault(pid, True)
    if "patient_initiative" in features and "emotion" not in features:
        features.setdefault("emotion", True)
    return config


def _create_record(
    db: Session,
    user_id: int,
    case: Case,
    case_data: dict,
    config: dict,
    *,
    practice_id: int | None = None,
    assignment_id: str | None = None,
    is_overdue: bool = False,
    app_state=None,
):
    time_limit = case_data.get("time_limit", 20)
    time_limit = config.get("behavior", {}).get("time_limit_minutes", time_limit) or time_limit

    config = _resolve_features(case_data, config)
    validate_case_data(case_data, strict=False)

    record = TrainingRecord(
        user_id=user_id,
        case_id=case.id,
        practice_id=practice_id,
        practice_snapshot=config or None,
        assignment_id=assignment_id,
        is_overdue=is_overdue,
        status="in_progress",
        time_limit=time_limit,
    )
    record.current_phase = "history_taking"
    db.add(record)
    db.flush()

    patient_info = case_data.get("patient_info", {})
    patient_name = patient_info.get("name", "患者")
    opening_line = case_data.get("opening_line", "我今天感觉不太舒服，所以来看看。")
    greeting = f"你好，我是{patient_name}。{opening_line}"

    greeting_msg = Message(record_id=record.id, role="patient", content=greeting)
    db.add(greeting_msg)
    db.commit()
    db.refresh(record)

    from repositories.rubric import load_active_rubric, load_rubric_by_version

    def _resolve_rubric_ref(rubric_ref: str) -> str:
        if rubric_ref == "active":
            active = load_active_rubric()
            if active:
                return f"{active.name}@{active.version}"
            return "nursing_history_v1@1.0"
        load_rubric_by_version(rubric_ref)  # validate it resolves
        return rubric_ref

    record.rubric_frozen = _resolve_rubric_ref(case_data.get("rubric_ref", "active"))

    features = resolve_features(record.practice_snapshot)
    if app_state is not None and features.get("patient_initiative"):
        from contexts.patient.initiative import update_initiative_timer

        update_initiative_timer(record.id, app_state.initiative_cache, db)

    return record, greeting


@router.post("/start", response_model=TrainingStartResponse)
def start_training(
    req: TrainingStartRequest,
    current_user: Annotated[User, Depends(require_permission("training_access"))],
    db: Annotated[Session, Depends(get_db)],
    request: Request,
):
    effective_school = resolve_school_filter(current_user)
    case_query = db.query(Case).filter(Case.id == req.case_id)
    if effective_school is not None:
        case_query = case_query.filter((Case.school_id == effective_school) | (Case.school_id.is_(None)))
    case = case_query.first()
    if not case:
        raise NotFoundError(detail="病例不存在")

    if req.practice_id:
        practice = db.query(Practice).filter(Practice.id == req.practice_id, Practice.case_id == req.case_id).first()
        if not practice:
            raise HTTPException(status_code=400, detail="练习模板不存在或不属于该病例")
        config = {
            "id": practice.id,
            "name": practice.name,
            "mode": practice.mode,
            "features": practice.features or {},
            "behavior": practice.behavior or {},
            "assessment": practice.assessment or {},
        }
    else:
        practice = db.query(Practice).filter(Practice.case_id == req.case_id, Practice.is_active == True).first()
        if practice:
            config = {
                "id": practice.id,
                "name": practice.name,
                "mode": practice.mode,
                "features": practice.features or {},
                "behavior": practice.behavior or {},
                "assessment": practice.assessment or {},
            }
        else:
            config = get_config("standard-assessment") or {}

    record, greeting = _create_record(
        db,
        current_user.id,
        case,
        case.case_data or {},
        config,
        practice_id=practice.id if practice else None,
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
    return TrainingStartResponse(record_id=record.id, greeting=greeting, case_name=case.name)


@router.post("/start-from-assignment", response_model=TrainingStartResponse)
def start_training_from_assignment(
    current_user: Annotated[User, Depends(require_permission("training_access"))],
    db: Annotated[Session, Depends(get_db)],
    request: Request,
    assignment_id: str = Query(...),
):
    assignment = (
        db.query(Assignment)
        .options(joinedload(Assignment.practice).joinedload(Practice.case))
        .filter(Assignment.id == assignment_id)
        .first()
    )
    if not assignment:
        raise NotFoundError(detail="练习发布不存在")

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

    existing = (
        db.query(TrainingRecord)
        .filter(
            TrainingRecord.user_id == current_user.id,
            TrainingRecord.assignment_id == assignment.id,
        )
        .first()
    )
    if existing:
        student_msg_count = (
            db.query(Message).filter(Message.record_id == existing.id, Message.role == "student").count()
        )
        if student_msg_count == 0:
            db.query(Message).filter(Message.record_id == existing.id).delete()
            db.query(NursingRecord).filter(NursingRecord.record_id == existing.id).delete()
            db.query(QuestionnaireResponse).filter(QuestionnaireResponse.record_id == existing.id).update(
                {QuestionnaireResponse.record_id: None}, synchronize_session="fetch"
            )
            db.delete(existing)
            db.commit()
        else:
            case_data = assignment.practice.case.case_data if assignment.practice and assignment.practice.case else {}
            patient_info = case_data.get("patient_info", {})
            patient_name = patient_info.get("name", "患者")
            greeting = f"你好，我是{patient_name}。{case_data.get('opening_line', '我今天感觉不太舒服，所以来看看。')}"
            return TrainingStartResponse(
                record_id=existing.id,
                greeting=greeting,
                case_name=assignment.practice.case.name if assignment.practice and assignment.practice.case else "",
            )

    practice = assignment.practice
    if not practice or not practice.case:
        raise NotFoundError(detail="练习模板或病例不存在")
    case = practice.case

    config = {
        "id": practice.id,
        "name": practice.name,
        "mode": practice.mode,
        "features": practice.features or {},
        "behavior": practice.behavior or {},
        "assessment": practice.assessment or {},
    }

    now = datetime.now(UTC)
    record, greeting = _create_record(
        db,
        current_user.id,
        case,
        case.case_data or {},
        config,
        practice_id=practice.id,
        assignment_id=assignment.id,
        is_overdue=now > ensure_utc(assignment.end_time),
        app_state=request.app.state,
    )

    log.info(
        f"Assignment training start: assignment_id={assignment.id} record_id={record.id}",
        extra={"user_id": current_user.id, "action": "assignment_start"},
    )
    return TrainingStartResponse(record_id=record.id, greeting=greeting, case_name=case.name)


@router.get("/configs")
def get_session_configs():
    return list_configs()


@router.get("/records", response_model=PaginatedResponse[TrainingRecordBrief])
def get_records(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    student_name: Annotated[str | None, Query(description="按学生姓名模糊搜索")] = None,
    case_id: Annotated[int | None, Query(description="按病例ID筛选")] = None,
    status: Annotated[str | None, Query(description="按状态筛选(in_progress/completed)")] = None,
    date_from: Annotated[str | None, Query(description="开始日期 ISO 格式 (含)")] = None,
    date_to: Annotated[str | None, Query(description="结束日期 ISO 格式 (含)")] = None,
    class_id: Annotated[int | None, Query()] = None,
    school_id: Annotated[int | None, Query(description="super_admin 按学校筛选")] = None,
):
    effective_school = resolve_school_filter(current_user, school_id)
    base = db.query(TrainingRecord)

    if effective_school is not None:
        base = base.join(User, TrainingRecord.user_id == User.id).filter(User.school_id == effective_school)

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
    ).order_by(TrainingRecord.start_time.desc())

    records, total = paginate(query, offset, limit)

    items = [
        TrainingRecordBrief(
            id=r.id,
            case_id=r.case_id,
            case_name=r.case.name if r.case else "",
            user_display_name=r.user.display_name if r.user else "",
            user_student_id=r.user.student_id if r.user else None,
            status=r.status,
            current_phase=r.current_phase,
            start_time=r.start_time,
            end_time=r.end_time,
            score_total=r.score.total_score if r.score else None,
            scoring_status=r.scoring_status,
            scoring_error=r.scoring_error,
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
        )
        .filter(TrainingRecord.id == record_id)
        .first()
    )
    if not record:
        raise NotFoundError(detail="记录不存在")

    if not current_user.has_permission("score_review") and record.user_id != current_user.id:
        raise AuthError(detail="无权查看此记录", status_code=403)

    effective_school = resolve_school_filter(current_user)
    if effective_school is not None and (not record.user or record.user.school_id != effective_school):
        raise NotFoundError(detail="记录不存在")

    case = record.case
    user = record.user
    score = record.score
    note_records = db.query(Note).filter(Note.record_id == record_id).order_by(Note.updated_at.desc()).all()

    case_data = case.case_data or {} if case else {}
    time_limit = record.time_limit or 20
    remaining_seconds = None
    if record.status == "in_progress" and record.start_time:
        elapsed = (datetime.now(UTC) - ensure_utc(record.start_time)).total_seconds()
        remaining_seconds = max(0, int(time_limit * 60 - elapsed))
    patient_info = case_data.get("patient_info", {})

    return TrainingRecordDetail(
        id=record.id,
        case_id=record.case_id,
        case_name=case.name if case else "",
        user_display_name=user.display_name if user else "",
        status=record.status,
        current_phase=record.current_phase,
        scoring_status=record.scoring_status,
        scoring_error=record.scoring_error,
        start_time=record.start_time,
        end_time=record.end_time,
        time_limit=time_limit,
        remaining_seconds=remaining_seconds,
        messages=record.messages,  # ty: ignore[invalid-argument-type]
        score=score,  # ty: ignore[invalid-argument-type]
        notes=note_records,  # ty: ignore[invalid-argument-type]
        required_inquiries=case_data.get("required_inquiries", []),
        patient_info=patient_info,
        patient_gender=normalize_gender(patient_info.get("gender", "")),
        features=resolve_features(record.practice_snapshot),
        from_assignment=record.assignment_id is not None,
        exam_anchors=case_data.get("exam_anchors", {}),
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

    record_user = db.query(User).filter(User.id == record.user_id).first()
    effective_school = resolve_school_filter(current_user)
    if effective_school is not None and (not record_user or record_user.school_id != effective_school):
        raise NotFoundError(detail="训练记录不存在")

    db.query(Message).filter(Message.record_id == record_id).delete()
    db.query(Score).filter(Score.record_id == record_id).delete()
    db.query(Note).filter(Note.record_id == record_id).delete()
    db.query(LLMCallLog).filter(LLMCallLog.record_id == record_id).delete()
    db.query(NursingRecord).filter(NursingRecord.record_id == record_id).delete()
    db.query(QuestionnaireResponse).filter(QuestionnaireResponse.record_id == record_id).update(
        {QuestionnaireResponse.record_id: None}, synchronize_session="fetch"
    )
    db.delete(record)
    db.commit()

    log.info(
        f"训练记录删除: record_id={record_id} case_id={record.case_id} owner_id={record.user_id}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )
    return {"message": "训练记录已删除"}
