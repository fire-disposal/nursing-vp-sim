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
from core.statuses import TrainingMode, TrainingStatus, normalize_training_mode
from models import (
    Assignment,
    Case,
    CaseQuestionnaire,
    LLMCallLog,
    Message,
    NursingRecord,
    QuestionnaireResponse,
    Score,
    TrainingRecord,
    TrainingSessionState,
    User,
    UserClass,
    VoiceCallLog,
)
from modules.training.capabilities import detect_capabilities
from modules.training.profile import PROFILE
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


def _extract_vitals(case_data: dict, training_type: str) -> dict:
    """Extract initial vital signs from tools.physical_exam.

    Resolution order: tools.physical_exam.vital_signs → exam_anchors.vital_signs → vitals.
    Range strings are resolved to midpoint numeric values.
    """
    tools = (case_data or {}).get("tools", {}) if isinstance(case_data, dict) else {}
    anchors = tools.get("physical_exam") if isinstance(tools.get("physical_exam"), dict) else None
    if not anchors:
        anchors = case_data.get("exam_anchors", {})

    vital_signs = (anchors or {}).get("vital_signs") or {}
    if isinstance(vital_signs, dict) and vital_signs:
        return _resolve_vital_signs(vital_signs)

    # Backward compat: triage flat vitals dict
    vitals = case_data.get("vitals", {}) if isinstance(case_data, dict) else {}
    return dict(vitals) if isinstance(vitals, dict) else {}


def _resolve_vital_signs(vital_signs: dict) -> dict:
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
    training_type = "history_taking"

    time_limit = config.get("behavior", {}).get("time_limit_minutes") or case.time_limit_minutes or 20
    time_limit = max(5, min(120, int(time_limit)))

    config["features"] = config.get("features") or {}
    validate_case_data(case_data, strict=False)

    record = TrainingRecord(
        user_id=user_id,
        case_id=case.id,
        practice_snapshot=config or None,
        assignment_id=assignment_id,
        is_overdue=is_overdue,
        training_type=training_type,
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
    profile = PROFILE
    resolved_features = detect_capabilities(
        case_data=case_data,
        training_type=training_type,
        overrides=(record.practice_snapshot or {}).get("features"),
    )
    from modules.training.scoring.rubric import build_final_rubric

    record.rubric_snapshot = build_final_rubric(profile.rubric, resolved_features)
    record.prompt_snapshot = {
        "schema_version": 2,
        "purpose": "patient_chat",
        "segments": {
            "system": profile.prompts.system,
            "dynamic": profile.prompts.dynamic,
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
        "training_type": training_type,
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

    record, greeting, session = _create_record(
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
            TrainingRecord.status.notin_(
                [TrainingStatus.IN_PROGRESS, TrainingStatus.DISCARDED, TrainingStatus.ABANDONED]
            ),
        )
        .count()
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
            # 超期作业的进行中记录不能继续对话（会立即触发交卷倒计时），明确拒绝
            raise HTTPException(status_code=400, detail="该作业已过期，无法继续训练，请先交卷查看成绩")
        case = assignment.case
        case_data = case.case_data if case else {}
        patient_info = case_data.get("patient_info", {})
        patient_name = patient_info.get("name", "患者")
        greeting = f"你好，我是{patient_name}。{case_data.get('opening_line', '我今天感觉不太舒服，所以来看看。')}"
        return TrainingStartResponse(
            record_id=existing.id,
            greeting=greeting,
            case_name="隐藏病例练习"
            if (assignment.behavior or {}).get("hide_case_info")
            else (case.name if case else ""),
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

    record, greeting, session = _create_record(
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
        case_name="隐藏病例练习" if (assignment.behavior or {}).get("hide_case_info") else case.name,
        session=session,
        pending_questionnaires=_count_pending_questionnaires(db, case.id),
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

    case = db.query(Case).filter(Case.is_open == True).order_by(func.random()).first()
    if not case:
        raise HTTPException(status_code=400, detail="暂无可用的自主练习病例，请稍后再试")

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
        case.case_data or {},
        config,
        app_state=request.app.state,
    )

    pending_questionnaires = _count_pending_questionnaires(db, case.id)
    session["pending_questionnaires"] = pending_questionnaires
    return TrainingStartResponse(
        record_id=record.id,
        greeting=greeting,
        case_name="盲盒训练",
        pending_questionnaires=pending_questionnaires,
        session=session,
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
