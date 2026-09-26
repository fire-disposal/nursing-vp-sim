import logging
from copy import deepcopy
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from core.database import get_db
from core.datetime_utils import ensure_utc
from core.exceptions import AuthError, NotFoundError
from core.security import get_current_user, load_role_permissions, require_permission
from core.statuses import (
    AssignmentLifecycle,
    TrainingMode,
    TrainingStatus,
    normalize_training_mode,
)
from core.time_limits import resolve_time_limit_minutes
from models import (
    CASE_STATUS_PUBLISHED,
    Assignment,
    AssignmentRecipient,
    Case,
    ClassMembership,
    LLMCallLog,
    Message,
    NursingRecord,
    QuestionnaireResponse,
    Score,
    TrainingRecord,
    TrainingSessionState,
    User,
    VoiceCallLog,
)
from modules.assignments.progress import count_attempts, effective_status
from modules.cases.revisions import require_current_revision, require_pinned_revision, require_publishable
from modules.questionnaires.response_service import count_pending_required
from modules.training.workflows import (
    WorkflowDefinition,
    workflow_for_case_revision,
)
from schemas import (
    DeleteResponse,
    OkResponse,
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
    ]
    for model, column in tables:
        db.query(model).filter(column == record_id).delete(synchronize_session="fetch")


def _lock_user_row(db: Session, user_id: int) -> None:
    """行级锁串行化同一用户的并发 start，防全局唯一 in_progress 竞态双开。"""
    db.query(User).filter(User.id == user_id).with_for_update().first()


def _build_config(features: dict | None = None, time_limit_minutes: int | None = None) -> dict:
    return {
        "id": 0,
        "name": "自定义配置",
        "features": features or {},
        "behavior": {"time_limit_minutes": time_limit_minutes} if time_limit_minutes else {},
    }


def _public_patient_info(case_data: dict) -> dict:
    """Return only patient facts known before the interview starts."""
    raw = case_data.get("patient_info") if isinstance(case_data, dict) else None
    info = raw if isinstance(raw, dict) else {}
    return {
        "name": str(info.get("name") or "患者"),
        "age": int(info.get("age") or 0),
        "gender": normalize_gender(info.get("gender", "")),
    }


_VITAL_KEYS_BY_EXAM: dict[str, tuple[str, ...]] = {
    "hr": ("hr",),
    "bp": ("bp_sys", "bp_dia"),
    "rr": ("rr",),
    "spo2": ("spo2",),
    "temp": ("temp",),
    "pain": ("pain",),
}


def _public_scene(record: TrainingRecord) -> dict | None:
    """Redact unmeasured vital signs from history-taking scene state."""
    raw = dict(record.runtime_state or {}).get("scene")
    if not isinstance(raw, dict):
        return None
    scene = deepcopy(raw)

    exam_results = dict(record.runtime_state or {}).get("exam_results", [])
    completed = {str(item.get("type") or item.get("op_type")) for item in exam_results if isinstance(item, dict)}
    allowed_vitals = {key for op_type in completed for key in _VITAL_KEYS_BY_EXAM.get(op_type, ())}
    vitals = scene.get("vitals")
    if isinstance(vitals, dict):
        scene["vitals"] = {key: value for key, value in vitals.items() if key in allowed_vitals}
    return scene


def _load_nursing_record(db: Session, record_id: int) -> tuple[dict | None, datetime | None]:
    """护理评估展示态：``(sheet, submitted_at)``。

    ``sheet`` 为 None 表示没有可展示内容；``submitted_at`` 是提交状态的唯一真值——
    「有草稿但未提交」必须与「已提交（该版本参与评分）」在前端可区分。
    """
    nr = db.query(NursingRecord).filter(NursingRecord.record_id == record_id).first()
    if nr is None:
        return None, None
    sheet = dict(nr.sheet_data) if isinstance(nr.sheet_data, dict) and nr.sheet_data else None
    return sheet, nr.submitted_at


def _create_record(
    db: Session,
    user_id: int,
    case: Case,
    case_data: dict,
    config: dict,
    *,
    workflow: WorkflowDefinition,
    revision_id: int | None = None,
    assignment_id: str | None = None,
    is_overdue: bool = False,
    app_state=None,
):
    """创建训练记录并**冻结**本次训练的 workflow（``workflow_id``）。

    ``workflow`` 由调用方从**钉住的 CaseRevision** 解析（``workflow_for_case_revision``）；
    请求体无法选择 workflow（``TrainingStartRequest`` 不接受该字段），因此记录的判别值
    只有病例内容一个来源。
    """
    declared = config.get("behavior", {}).get("time_limit_minutes") or case.time_limit_minutes
    source = "assignment" if config.get("behavior", {}).get("time_limit_minutes") else "case"
    time_limit = resolve_time_limit_minutes(declared, source=source)

    config["features"] = config.get("features") or {}
    # 形状校验（warn-only）：冻结内容已在发布/种子时过过校验，且元数据只在列上
    # （case_data 里没有 name/difficulty/time_limit），所以拼回列值再校验，避免
    # 「元数据缺失」这种假警报。
    validate_case_data(
        {
            **case_data,
            "name": case.name,
            "difficulty": case.difficulty,
            "time_limit": case.time_limit_minutes,
        },
        strict=False,
    )

    record = TrainingRecord(
        user_id=user_id,
        case_id=case.id,
        practice_snapshot=config or None,
        assignment_id=assignment_id,
        is_overdue=is_overdue,
        case_revision_id=revision_id,
        workflow_id=workflow.id,
        status=TrainingStatus.IN_PROGRESS,
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
    resolved_features = workflow.resolve_features(
        case_data,
        overrides=(record.practice_snapshot or {}).get("features"),
    )
    from modules.training.scoring.rubric import build_final_rubric

    record.rubric_snapshot = build_final_rubric(workflow.rubric, resolved_features)
    record.prompt_snapshot = {
        "schema_version": 2,
        "purpose": "patient_chat",
        "segments": {
            "system": workflow.prompts.system,
            "dynamic": workflow.prompts.dynamic,
        },
    }

    behavior_cfg = config.get("behavior") or {}
    # 隐藏病例身份：自主盲盒（mode=blind_box）或作业隐藏开关（hide_case_info）
    hidden_case = normalize_training_mode(behavior_cfg.get("mode")) == TrainingMode.BLIND_BOX.value or bool(
        behavior_cfg.get("hide_case_info")
    )
    patient_info = case_data.get("patient_info", {})
    public_patient_info = _public_patient_info(case_data)
    patient_name = patient_info.get("name", "患者")
    if hidden_case:
        # 隐藏病例：问候语中性化，不携带病例/患者线索
        greeting = "你好，我是今天来就诊的患者。你先了解一下我的情况，有什么想问的尽管问我。"
    else:
        opening_line = case_data.get("opening_line", "我今天感觉不太舒服，所以来看看。")
        greeting = f"你好，我是{patient_name}。{opening_line}"

    greeting_msg = Message(record_id=record.id, role="patient", content=greeting)
    db.add(greeting_msg)

    # D-1：播种 scene 初始状态（从病例数据派生，供前端 MonitorCard/SceneRenderer 消费）。
    # 分诊/急诊只作为 history_taking 的 scene 设定存在，不再切换训练类型。
    patient_info = case_data.get("patient_info", {})
    raw_scene = case_data.get("scene")
    scene_seed = raw_scene if isinstance(raw_scene, dict) else {}
    raw_environment = scene_seed.get("environment")
    raw_patient = scene_seed.get("patient")
    raw_vitals = scene_seed.get("vitals")
    environment_seed = raw_environment if isinstance(raw_environment, dict) else {}
    patient_seed = raw_patient if isinstance(raw_patient, dict) else {}
    vitals_seed = raw_vitals if isinstance(raw_vitals, dict) else {}
    record.runtime_state = {
        "scene": {
            "environment": {
                "type": environment_seed.get("type", "ward"),
                "time_of_day": environment_seed.get("time_of_day", "day"),
                "equipment": environment_seed.get("equipment", []),
                "noise_level": environment_seed.get("noise_level", "quiet"),
            },
            "patient": {
                "position": patient_seed.get("position", "semi-recumbent"),
                "consciousness": patient_seed.get("consciousness", "alert"),
                "visible_symptoms": patient_seed.get("visible_symptoms", patient_info.get("visible_symptoms", [])),
                "expression": patient_seed.get("expression", patient_info.get("expression", "neutral")),
            },
            "vitals": {
                "hr": vitals_seed.get("hr"),
                "bp_sys": vitals_seed.get("bp_sys"),
                "bp_dia": vitals_seed.get("bp_dia"),
                "spo2": vitals_seed.get("spo2"),
                "rr": vitals_seed.get("rr"),
                "temp": vitals_seed.get("temp"),
                "pain": vitals_seed.get("pain"),
            },
        }
    }

    snapshot = record.practice_snapshot or {}
    snapshot["features"] = resolved_features
    record.practice_snapshot = snapshot
    if app_state is not None and resolved_features.get("patient_initiative"):
        from modules.training.patient_ai.initiative import update_initiative_timer

        update_initiative_timer(record.id, app_state.initiative_cache, db)

    db.commit()

    # 构建会话数据 — 前端可直接缓存，跳过初始 GET /records/{id} 请求
    session = {
        "id": record.id,
        "status": TrainingStatus.IN_PROGRESS,
        "case_id": case.id,
        "start_time": record.start_time.isoformat() if record.start_time else None,
        "time_limit": time_limit,
        "remaining_seconds": time_limit * 60,
        "mode": normalize_training_mode((config.get("behavior") or {}).get("mode")),
        "hide_case_info": hidden_case,
        "patient_name": "患者" if hidden_case else public_patient_info["name"],
        "patient_age": 0 if hidden_case else public_patient_info["age"],
        "patient_gender": "" if hidden_case else public_patient_info["gender"],
        "case_title": "" if hidden_case else case_data.get("title", "") or case.name,
        "chief_complaint": "" if hidden_case else case_data.get("chief_complaint", ""),
        "patient_info": ({"name": "患者", "age": 0, "gender": ""} if hidden_case else public_patient_info),
        "features": resolved_features,
        "messages": [
            {
                "id": greeting_msg.id,
                "role": "patient",
                "content": greeting,
                "created_at": record.start_time.isoformat() if record.start_time else None,
            }
        ],
        "scene": _public_scene(record),
        "pending_questionnaires": 0,
        "from_assignment": assignment_id is not None,
    }
    return record, greeting, session


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

    _lock_user_row(db, current_user.id)
    # Global: only ONE in_progress regardless of assignment or free practice
    global_existing = (
        db.query(TrainingRecord)
        .filter(
            TrainingRecord.user_id == current_user.id,
            TrainingRecord.status == TrainingStatus.IN_PROGRESS,
        )
        .first()
    )
    if global_existing:
        gc = global_existing.case or db.query(Case).filter(Case.id == global_existing.case_id).first()
        raise HTTPException(
            status_code=409,
            detail={
                "code": "existing_training",
                "record_id": global_existing.id,
                "case_name": gc.name if gc else "未知病例",
                "started_at": global_existing.start_time.isoformat() if global_existing.start_time else None,
            },
        )

    config = _build_config(req.features, req.time_limit_minutes)
    # 学员训练按**已发布版本**的内容进行（docs/15 §六）：病例后续编辑不改变本次训练。
    # workflow 也由这条 revision 决定（请求体不能选择 workflow）并冻结在记录上。
    revision = require_current_revision(db, case)

    record, greeting, session = _create_record(
        db,
        current_user.id,
        case,
        revision.content or {},
        config,
        workflow=workflow_for_case_revision(revision),
        revision_id=revision.id,
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
    pending_questionnaires = count_pending_required(db, current_user.id, case.id)
    session["pending_questionnaires"] = pending_questionnaires

    return TrainingStartResponse(
        record_id=record.id,
        greeting=greeting,
        case_name=case.name,
        pending_questionnaires=pending_questionnaires,
        session=session,
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

    # 关闭 / 逾期由同一口径推导（modules.assignments.progress.effective_status）
    lifecycle = effective_status(assignment.is_closed, assignment.end_time, datetime.now(UTC))
    if lifecycle is AssignmentLifecycle.CLOSED:
        raise HTTPException(status_code=400, detail="该作业已被教师关闭")

    now = datetime.now(UTC)
    if assignment.start_time and now < ensure_utc(assignment.start_time):
        raise HTTPException(status_code=400, detail="该作业尚未开始，请在开放时间后再试")

    is_overdue = lifecycle is AssignmentLifecycle.ENDED

    # 班级门槛按成员语义（student membership），不再依赖"任意一条关联"
    in_class = (
        db.query(ClassMembership)
        .filter(
            ClassMembership.user_id == current_user.id,
            ClassMembership.class_id == assignment.class_id,
            ClassMembership.member_role == "student",
        )
        .first()
    )
    if not in_class:
        raise AuthError(detail="你不在该练习的目标班级中", status_code=403)

    # 受众只认发布时固化的 recipient 快照（全班/指定学生统一走同一张表）
    recipient = (
        db.query(AssignmentRecipient)
        .filter(
            AssignmentRecipient.assignment_id == assignment.id,
            AssignmentRecipient.user_id == current_user.id,
        )
        .first()
    )
    if recipient is None:
        raise AuthError(detail="该作业未发布给你", status_code=403)

    attempt_count = count_attempts(
        row[0]
        for row in db.query(TrainingRecord.status)
        .filter(
            TrainingRecord.user_id == current_user.id,
            TrainingRecord.assignment_id == assignment.id,
            TrainingRecord.is_test == False,
        )
        .all()
    )

    if assignment.max_attempts and assignment.max_attempts > 0 and attempt_count >= assignment.max_attempts:
        raise HTTPException(status_code=400, detail="已达到最大尝试次数，无法开始新训练")
    _lock_user_row(db, current_user.id)
    # Global: only ONE in_progress regardless of assignment or is_test
    global_existing = (
        db.query(TrainingRecord)
        .filter(
            TrainingRecord.user_id == current_user.id,
            TrainingRecord.status == TrainingStatus.IN_PROGRESS,
        )
        .first()
    )
    if global_existing and (
        global_existing.assignment_id != assignment.id
        or global_existing.case_id != (assignment.case.id if assignment.case else None)
    ):
        case = global_existing.case or db.query(Case).filter(Case.id == global_existing.case_id).first()
        raise HTTPException(
            status_code=409,
            detail={
                "code": "existing_training",
                "record_id": global_existing.id,
                "case_name": case.name if case else "未知病例",
                "started_at": global_existing.start_time.isoformat() if global_existing.start_time else None,
            },
        )

    # Same assignment: return existing record
    existing = (
        db.query(TrainingRecord)
        .filter(
            TrainingRecord.user_id == current_user.id,
            TrainingRecord.assignment_id == assignment.id,
            TrainingRecord.status == TrainingStatus.IN_PROGRESS,
            TrainingRecord.is_test == False,
        )
        .first()
    )
    if existing:
        if is_overdue:
            # 超期作业的进行中记录不再放行继续（作业截止是教师语义，与训练时长无关）
            raise HTTPException(status_code=400, detail="该作业已过截止时间")
        case = assignment.case
        # 进行中的记录自带冻结内容（case_snapshot），问候语不得读病例的最新工作副本
        case_data = existing.case_snapshot or (case.case_data if case else {})
        patient_info = case_data.get("patient_info", {})
        patient_name = patient_info.get("name", "患者")
        greeting = f"你好，我是{patient_name}。{case_data.get('opening_line', '我今天感觉不太舒服，所以来看看。')}"
        return TrainingStartResponse(
            record_id=existing.id,
            greeting=greeting,
            case_name="隐藏病例练习"
            if (assignment.behavior or {}).get("hide_case_info")
            else (case.name if case else ""),
            pending_questionnaires=count_pending_required(db, current_user.id, case.id if case else 0),
        )

    if is_overdue:
        raise HTTPException(status_code=400, detail="该作业已过截止时间")

    case = assignment.case
    if not case:
        raise NotFoundError(detail="病例不存在")

    config = {
        "id": 0,
        "name": case.name,
        "features": assignment.features or {},
        "behavior": assignment.behavior or {},
    }

    # 归档病例不得用于**新的**训练（既有作业也拦，docs/15 §六：archived 只阻止新使用）；
    # 进行中的记录走上面的 existing 分支，不受影响。
    require_publishable(case)
    # 作业钉住的病例版本（发布时固化，列已 NOT NULL）：解析不到就拒绝开始，
    # 不回落病例当前版本 —— 否则同一作业会在不同时间跑在不同内容上。
    revision = require_pinned_revision(db, assignment.case_revision_id, case=case)
    record, greeting, session = _create_record(
        db,
        current_user.id,
        case,
        revision.content or {},
        config,
        workflow=workflow_for_case_revision(revision),
        revision_id=revision.id,
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
        case_name="隐藏病例练习" if (assignment.behavior or {}).get("hide_case_info") else case.name,
        session=session,
        pending_questionnaires=count_pending_required(db, current_user.id, case.id),
    )


@router.post("/start-blind-box", response_model=TrainingStartResponse)
def start_blind_box_training(
    current_user: Annotated[User, Depends(require_permission("training_access"))],
    db: Annotated[Session, Depends(get_db)],
    request: Request,
):
    """盲盒训练：从全部开放病例随机抽取一个开始，隐藏标题与引导内容。

    属自主训练（无 assignment，mode=blind_box）。训练进行中 detail/brief 脱敏，
    结束后揭示病例便于复盘。
    """
    _lock_user_row(db, current_user.id)
    global_existing = (
        db.query(TrainingRecord)
        .filter(
            TrainingRecord.user_id == current_user.id,
            TrainingRecord.status == TrainingStatus.IN_PROGRESS,
        )
        .first()
    )
    if global_existing:
        gc = global_existing.case or db.query(Case).filter(Case.id == global_existing.case_id).first()
        raise HTTPException(
            status_code=409,
            detail={
                "code": "existing_training",
                "record_id": global_existing.id,
                "case_name": gc.name if gc else "未知病例",
                "started_at": global_existing.start_time.isoformat() if global_existing.start_time else None,
            },
        )

    case = (
        db.query(Case)
        .filter(Case.is_open == True, Case.status == CASE_STATUS_PUBLISHED)
        .order_by(func.random())
        .first()
    )
    if not case:
        raise HTTPException(status_code=400, detail="暂无可用的自主练习病例，请稍后再试")
    revision = require_current_revision(db, case)

    config = {
        "id": 0,
        "name": "盲盒训练",
        "features": {},
        "behavior": {"mode": TrainingMode.BLIND_BOX.value},
    }
    record, greeting, session = _create_record(
        db,
        current_user.id,
        case,
        revision.content or {},
        config,
        workflow=workflow_for_case_revision(revision),
        revision_id=revision.id,
        app_state=request.app.state,
    )

    pending_questionnaires = count_pending_required(db, current_user.id, case.id)
    session["pending_questionnaires"] = pending_questionnaires
    return TrainingStartResponse(
        record_id=record.id,
        greeting=greeting,
        case_name="盲盒训练",
        pending_questionnaires=pending_questionnaires,
        session=session,
    )


@router.post("/records/{record_id}/pause", response_model=OkResponse)
def pause_training(
    record_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    questionnaire: Annotated[bool, Query()] = False,
):
    """记录离页暂停，或在必做训练前问卷期间冻结倒计时。"""
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise NotFoundError(detail="训练记录不存在")
    if not current_user.has_permission("score_review") and record.user_id != current_user.id:
        raise AuthError(detail="无权操作此记录", status_code=403)
    if record.status != TrainingStatus.IN_PROGRESS:
        return OkResponse(message="训练已结束，无需暂停")

    mode = normalize_training_mode((record.practice_snapshot or {}).get("behavior", {}).get("mode"))
    rs = dict(record.runtime_state or {})
    now = datetime.now(UTC)
    if questionnaire:
        pending_required = count_pending_required(db, current_user.id, record.case_id)
        if pending_required == 0:
            return OkResponse(message="没有待完成的必做训练前问卷")
        if not rs.get("questionnaire_paused_at"):
            rs["questionnaire_paused_at"] = now.isoformat()
            record.runtime_state = rs
            db.commit()
        return OkResponse(message="问卷作答期间计时已暂停")

    changed = False
    questionnaire_paused_at = rs.pop("questionnaire_paused_at", None)
    if questionnaire_paused_at:
        try:
            elapsed = max(
                0,
                int((now - ensure_utc(datetime.fromisoformat(questionnaire_paused_at))).total_seconds()),
            )
        except (TypeError, ValueError):
            elapsed = 0
        rs["questionnaire_paused_seconds"] = int(rs.get("questionnaire_paused_seconds", 0)) + elapsed
        changed = True

    if mode == TrainingMode.ASSESSMENT.value:
        if changed:
            record.runtime_state = rs
            db.commit()
        return OkResponse(message="独立考核离开后仍继续计时")

    if not rs.get("paused_at"):
        rs["paused_at"] = now.isoformat()
        changed = True
    if changed:
        record.runtime_state = rs
        db.commit()
    return OkResponse(message="训练已暂停")


@router.post("/records/{record_id}/resume", response_model=OkResponse)
def resume_training(
    record_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """恢复训练，并结算普通离页或训练前问卷产生的暂停时长。"""
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise NotFoundError(detail="训练记录不存在")
    if not current_user.has_permission("score_review") and record.user_id != current_user.id:
        raise AuthError(detail="无权操作此记录", status_code=403)

    mode = normalize_training_mode((record.practice_snapshot or {}).get("behavior", {}).get("mode"))
    rs = dict(record.runtime_state or {})
    now = datetime.now(UTC)
    changed = False
    pause_fields = [("questionnaire_paused_at", "questionnaire_paused_seconds")]
    if mode != TrainingMode.ASSESSMENT.value:
        pause_fields.append(("paused_at", "paused_seconds"))
    elif rs.pop("paused_at", None) is not None:
        changed = True

    for paused_at_key, paused_seconds_key in pause_fields:
        paused_at = rs.pop(paused_at_key, None)
        if not paused_at:
            continue
        try:
            elapsed = max(0, int((now - ensure_utc(datetime.fromisoformat(paused_at))).total_seconds()))
        except (TypeError, ValueError):
            elapsed = 0
        rs[paused_seconds_key] = int(rs.get(paused_seconds_key, 0)) + elapsed
        changed = True

    if changed:
        record.runtime_state = rs
        db.commit()
    if mode == TrainingMode.ASSESSMENT.value:
        return OkResponse(message="独立考核计时继续")
    return OkResponse(message="训练已恢复")


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
        db.query(QuestionnaireResponse).filter(QuestionnaireResponse.record_id == record_id).delete(
            synchronize_session="fetch"
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
    if record.status != TrainingStatus.IN_PROGRESS:
        raise HTTPException(status_code=400, detail="只能放弃进行中的训练")

    record.status = TrainingStatus.ABANDONED
    record.end_time = datetime.now(UTC)
    db.query(TrainingSessionState).filter(TrainingSessionState.record_id == record_id).delete()
    db.commit()

    log.info(
        f"训练记录放弃: record_id={record_id}",
        extra={"user_id": current_user.id, "action": "training_abandon"},
    )
    return {"message": "训练记录已放弃"}
