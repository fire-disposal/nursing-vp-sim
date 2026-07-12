import asyncio
import logging
import threading
from datetime import UTC, datetime
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session, joinedload

from core.capabilities import resolve_features
from core.case_schema import normalize_gender, validate_case_data
from core.database import get_db
from core.datetime_utils import ensure_utc, parse_iso_datetime
from core.exceptions import AuthError, NotFoundError
from core.pagination import paginate
from core.security import get_current_user, require_permission
from infrastructure.llm import LogWorker, ProfileRouter
from models import (
    Assignment,
    Case,
    CaseQuestionnaire,
    LLMCallLog,
    Message,
    Note,
    NursingRecord,
    Practice,
    QuestionnaireResponse,
    Score,
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
    PaginatedResponse,
    TrainingRecordBrief,
    TrainingRecordDetail,
    TrainingStartRequest,
    TrainingStartResponse,
)

log = logging.getLogger(__name__)

router = APIRouter()


def _try_acquire_scoring(record_id: int, db, allow_retry: bool = False) -> bool:
    """原子性地将 scoring_status 更新为 'pending'。

    用 DB 原子 UPDATE 代替内存锁，避免测试间状态泄漏，
    同时消除并发触发同一 record 评分的竞态。

    - allow_retry=False: 仅从 NULL 状态获取（正常 end_training 流程）
    - allow_retry=True:  从 NULL/completed/failed 获取（不抢占进行中的 pending/processing），
                         同时清除 scoring_error
    """
    from sqlalchemy import text

    if allow_retry:
        result = db.execute(
            text(
                "UPDATE training_records SET scoring_status = 'pending', scoring_error = NULL "
                "WHERE id = :id AND ("
                "  scoring_status IS NULL OR scoring_status IN ('completed', 'failed')"
                ")"
            ),
            {"id": record_id},
        )
    else:
        result = db.execute(
            text("UPDATE training_records SET scoring_status = 'pending' WHERE id = :id AND scoring_status IS NULL"),
            {"id": record_id},
        )
    if result.rowcount > 0:
        pass  # status already updated atomically by DB UPDATE
    return result.rowcount > 0


def _claim_for_scoring(record_id: int, db) -> bool:
    """原子性将可执行态（'pending' 或 NULL）转为 'processing'，供后台 worker 入口认领。

    - 'pending': end_training / retry_scoring / triage 经 _try_acquire_scoring 获取后的状态
    - NULL:      settlement 自动结算路径（未经 acquire）

    并发重复入队同一 record 时，DB 原子 UPDATE 保证仅一个 worker 认领成功（rowcount==1），
    其余 worker rowcount==0 直接跳过，实现幂等。
    """
    from sqlalchemy import text

    result = db.execute(
        text(
            "UPDATE training_records SET scoring_status = 'processing' "
            "WHERE id = :id AND (scoring_status = 'pending' OR scoring_status IS NULL)"
        ),
        {"id": record_id},
    )
    return result.rowcount > 0


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


def _build_config(practice=None, features: dict | None = None, time_limit_minutes: int | None = None) -> dict:
    if practice:
        return {
            "id": practice.id,
            "name": practice.name,
            "features": practice.features or {},
            "behavior": practice.behavior or {},
        }
    return {
        "id": 0,
        "name": "自定义配置",
        "features": features or {},
        "behavior": {"time_limit_minutes": time_limit_minutes} if time_limit_minutes else {},
    }


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
    training_type = case.training_type or "history_taking"
    profile = get_profile(training_type)

    # 时间优先级（D11）：显式设置(free-config req / 教师 practice) > case 默认 > 全局 20
    time_limit = config.get("behavior", {}).get("time_limit_minutes") or case.time_limit_minutes or 20

    config["features"] = config.get("features") or {}
    validate_case_data(training_type, case_data, strict=False)

    record = TrainingRecord(
        user_id=user_id,
        case_id=case.id,
        practice_id=practice_id,
        practice_snapshot=config or None,
        assignment_id=assignment_id,
        is_overdue=is_overdue,
        training_type=training_type,
        status="in_progress",
        time_limit=time_limit,
    )
    record.current_phase = profile.initial_phase
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

    # D-1：播种 scene 初始状态（从病例数据派生，供前端 MonitorCard/SceneRenderer 消费）
    patient_info = case_data.get("patient_info", {})
    vitals = case_data.get("vitals", {})
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
            "phase": profile.initial_phase,
        }
    }

    features = resolve_features(record.practice_snapshot)
    if app_state is not None and features.get("patient_initiative"):
        from profiles.history_taking.initiative import update_initiative_timer

        update_initiative_timer(record.id, app_state.initiative_cache, db)

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

    practice = None
    if req.practice_id:
        practice = db.query(Practice).filter(Practice.id == req.practice_id, Practice.case_id == req.case_id).first()
        if not practice:
            raise HTTPException(status_code=400, detail="练习模板不存在或不属于该病例")
    elif req.features is None:
        practice = db.query(Practice).filter(Practice.case_id == req.case_id, Practice.is_active == True).first()

    config = _build_config(practice, req.features, req.time_limit_minutes)

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
                pending_questionnaires=_count_pending_questionnaires(
                    db, assignment.practice.case.id if assignment.practice and assignment.practice.case else 0
                ),
            )

    practice = assignment.practice
    if not practice or not practice.case:
        raise NotFoundError(detail="练习模板或病例不存在")
    case = practice.case

    config = {
        "id": practice.id,
        "name": practice.name,
        "features": practice.features or {},
        "behavior": practice.behavior or {},
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
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    student_name: Annotated[str | None, Query(description="按学生姓名模糊搜索")] = None,
    case_id: Annotated[int | None, Query(description="按病例ID筛选")] = None,
    status: Annotated[str | None, Query(description="按状态筛选(in_progress/completed)")] = None,
    date_from: Annotated[str | None, Query(description="开始日期 ISO 格式 (含)")] = None,
    date_to: Annotated[str | None, Query(description="结束日期 ISO 格式 (含)")] = None,
    class_id: Annotated[int | None, Query()] = None,
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
            training_type=r.training_type or "history_taking",
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
    note_records = db.query(Note).filter(Note.record_id == record_id).order_by(Note.updated_at.desc()).all()
    pending_questionnaires = _count_pending_questionnaires(db, case.id) if case is not None else 0

    case_data = case.case_data or {} if case else {}
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
    session_state = (
        db.query(TrainingSessionState).filter(TrainingSessionState.record_id == record_id).first()
    )
    emotion = None
    initiative_count = 0
    if session_state is not None:
        es_dict = session_state.emotion_state
        if isinstance(es_dict, dict) and "trust" in es_dict:
            from profiles.history_taking.emotion import EmotionState

            es = EmotionState.from_dict(es_dict)
            emotion = {"trust": es.trust, "comfort": es.comfort, "state": es.state}
        initiative_count = session_state.initiative_count or 0

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
        training_type=record.training_type or "history_taking",
        features=resolve_features(record.practice_snapshot),
        from_assignment=record.assignment_id is not None,
        pending_questionnaires=pending_questionnaires,
        exam_anchors=case_data.get("exam_anchors", {}),
        exam_results=dict(record.runtime_state or {}).get("exam_results", []),
        triage_result=dict(record.runtime_state or {}).get("triage_result", {}),
        case_data=case_data,
        profile_info=profile_info,
        emotion=emotion,
        initiative_count=initiative_count,
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
        db.query(Message).filter(Message.record_id == record_id).delete()
        db.query(Score).filter(Score.record_id == record_id).delete()
        db.query(Note).filter(Note.record_id == record_id).delete()
        db.query(LLMCallLog).filter(LLMCallLog.record_id == record_id).delete()
        db.query(NursingRecord).filter(NursingRecord.record_id == record_id).delete()
        db.query(VoiceCallLog).filter(VoiceCallLog.record_id == record_id).delete()
        db.query(TrainingSessionState).filter(TrainingSessionState.record_id == record_id).delete()
        db.query(ScoringProgress).filter(ScoringProgress.record_id == record_id).delete()
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
