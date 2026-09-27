import logging
from copy import deepcopy
from datetime import UTC, datetime
from typing import Annotated, Any

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
from modules.training.participation import is_student_practice
from modules.training.practice import (
    PRACTICE_FIELD,
    PRACTICE_LABELS,
    PracticeTargetUnavailable,
    practice_snapshot_entry,
    resolve_practice_target,
)
from modules.training.prompt_identity import compute_context_policy_version
from modules.training.session.state import SceneState
from modules.training.workflows import (
    WorkflowDefinition,
    WorkflowNotStartableError,
    case_is_startable,
    require_startable,
    workflow_for_case_revision,
)
from schemas import (
    DeleteResponse,
    OkResponse,
    StartPracticeRequest,
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


def _stamp_experiment(config: dict, experiment: dict | None = None) -> dict:
    """给本次训练盖实验批次标签（可选）。

    标签来源优先级：本次请求显式指定 > 环境变量 ``EXPERIMENT_BATCH``。两者都没有时**不写这个键**
    —— 不做"默认批次"的臆造分组，历史与日常训练保持原样。评分与导出据此可把一批数据认出来。
    """
    from core.config import EXPERIMENT_BATCH

    batch = str((experiment or {}).get("batch") or EXPERIMENT_BATCH or "").strip()
    if not batch:
        return config
    payload: dict = {"batch": batch[:64]}
    arm = str((experiment or {}).get("arm") or "").strip()
    if arm:
        payload["arm"] = arm[:32]
    note = str((experiment or {}).get("note") or "").strip()
    if note:
        payload["note"] = note[:200]
    config["experiment"] = payload
    return config


def _portrait_states(raw: object) -> dict[str, str] | None:
    """情绪立绘映射的窄化：只保留非空字符串值。

    键是否在情绪闭集内由**发布门禁**把关（``modules/cases/validator``）——运行期不猜、
    不改写作者声明，只保证下发的是"字符串 → 字符串"。
    """
    if not isinstance(raw, dict):
        return None
    states = {str(key): value.strip() for key, value in raw.items() if isinstance(value, str) and value.strip()}
    return states or None


def _public_patient_info(case_data: dict) -> dict:
    """Return only patient facts known before the interview starts.

    ``portrait_states`` 一并下发：它是患者**形象**资产（不是病史事实），表现层据此按当前
    情绪换立绘；未声明的病例为 ``None``，前端与"只有单张立绘"的既有行为一致。
    """
    raw = case_data.get("patient_info") if isinstance(case_data, dict) else None
    info = raw if isinstance(raw, dict) else {}
    return {
        "name": str(info.get("name") or "患者"),
        "age": int(info.get("age") or 0),
        "gender": normalize_gender(info.get("gender", "")),
        "portrait_states": _portrait_states(info.get("portrait_states")),
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


#: 播种初始 scene 时，给**病例未声明**的键补的默认值（保留历史播种语义）。
#: ``SceneState`` 自己的字段默认值面向"从零构造一场戏"（``environment.type=clinic`` /
#: ``patient.position=supine``），与问诊病例的既有播种取值不同；这里显式保留旧值，避免
#: 存量病例的环境与体位随重构漂移。
_SCENE_SEED_DEFAULTS: dict[str, dict[str, Any]] = {
    "environment": {"type": "ward", "time_of_day": "day", "equipment": [], "noise_level": "quiet"},
    "patient": {"position": "semi-recumbent", "consciousness": "alert"},
}


def _seed_scene(case_data: dict) -> dict:
    """病例声明的初始 scene —— **整块**过 ``SceneState`` 校验，而不是逐键手挑。

    逐键手挑的代价：病例里**新声明**的场景字段（如 ``scene.patient.breathing``）会被静默
    丢弃，作者配了却不生效。整块过模型后，字段随模型新增自动跟着走（``PatientState`` 这类
    模型是 scene 形状的唯一 owner），枚举/类型也由模型兜住。

    只**补默认 + 校验**，不裁剪：未测量体征的裁剪是读侧 ``_public_scene`` 的事 —— 播种侧
    必须原样保留病例声明（否则床旁检查会拿着"没有这个键"的假事实开局）。
    形状非法时抛出（不是静默丢弃）：发布门禁（``validator._check_scene``）已把合法形状
    卡在发布前，运行期再遇到坏形状说明内容绕过了门禁，必须响。
    """
    raw = case_data.get("scene")
    scene: dict[str, Any] = dict(raw) if isinstance(raw, dict) else {}
    for section, defaults in _SCENE_SEED_DEFAULTS.items():
        declared = scene.get(section)
        scene[section] = {**defaults, **(declared if isinstance(declared, dict) else {})}
    info = case_data.get("patient_info")
    patient_info: dict[str, Any] = info if isinstance(info, dict) else {}
    patient: dict[str, Any] = scene["patient"]
    # patient_info 是同名场景字段的既有回落来源（病例未在 scene.patient 里声明时）
    if "visible_symptoms" not in patient:
        patient["visible_symptoms"] = patient_info.get("visible_symptoms") or []
    if "expression" not in patient:
        patient["expression"] = patient_info.get("expression") or "neutral"
    return SceneState.model_validate(scene).model_dump(exclude_none=True)


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


#: 训练入口产品状态冲突的机器可读码（前端据此显示「即将开放」而不是「开始失败」）。
CODE_WORKFLOW_NOT_STARTABLE = "workflow_not_startable"


def _require_startable_workflow(workflow: WorkflowDefinition) -> WorkflowDefinition:
    """训练入口的产品状态门（docs/15 §十六）。

    403/422 都不对：病例、权限、版本都没问题，冲突在于**产品状态** —— 这条闭包的学生
    工作区还没交付，所以是 409 + 机器可读 code + workflow 身份。绝不「先建一条记录再看」：
    空记录会永远无法渲染、无法评分，还占掉「同一时刻只能有一条进行中训练」的名额。
    """
    try:
        return require_startable(workflow)
    except WorkflowNotStartableError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": CODE_WORKFLOW_NOT_STARTABLE,
                "workflow": {"id": exc.workflow_id, "label": exc.label},
                "message": str(exc),
            },
        ) from exc


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

    **产品状态门在这里执行**（:func:`_require_startable_workflow`）：本函数是全仓唯一的
    ``TrainingRecord(...)`` 构造点，三个训练入口（自主 / 作业 / 盲盒）都经过它 —— 守卫放在
    这里，就不存在「新增入口忘了拦」的第二种可能。运行期未就绪的 workflow 一律 409，
    绝不落地一条永远无法渲染的记录。
    """
    workflow = _require_startable_workflow(workflow)
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
        # 「这条是不是学生练习」：教师/管理员开始的不算（规则见 modules/training/participation.py）。
        # 未取到用户时保留列默认值 true —— 记录必属于某个用户（FK），取不到即异常路径。
        record.is_student_practice = is_student_practice(permissions=load_role_permissions(db, user.role_id))

    db.add(record)
    db.flush()

    record.context_policy_version = compute_context_policy_version()
    record.case_snapshot = deepcopy(case_data)
    resolved_features = workflow.resolve_features(
        case_data,
        overrides=(record.practice_snapshot or {}).get("features"),
    )
    from modules.training.scoring.rubric import build_final_rubric

    record.rubric_snapshot = build_final_rubric(workflow.rubric, resolved_features)
    record.prompt_snapshot = {
        "schema_version": 2,
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
    # 整块过 `SceneState`（`_seed_scene`）：病例新声明的场景字段随模型自动播种，不再被逐键手挑丢掉。
    record.runtime_state = {"scene": _seed_scene(case_data)}

    snapshot = record.practice_snapshot or {}
    snapshot["features"] = resolved_features
    record.practice_snapshot = snapshot
    if app_state is not None and resolved_features.get("patient_initiative"):
        from modules.training.patient_ai.initiative import update_initiative_timer

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

    config = _stamp_experiment(_build_config(req.features, req.time_limit_minutes), req.experiment)
    # 学员训练按**已发布版本**的内容进行（docs/15 §六）：病例后续编辑不改变本次训练。
    # workflow 也由这条 revision 决定（请求体不能选择 workflow）并冻结在记录上。
    revision = require_current_revision(db, case)

    record, greeting = _create_record(
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
            TrainingRecord.is_student_practice == True,
        )
        .all()
    )

    if assignment.max_attempts and assignment.max_attempts > 0 and attempt_count >= assignment.max_attempts:
        raise HTTPException(status_code=400, detail="已达到最大尝试次数，无法开始新训练")
    _lock_user_row(db, current_user.id)
    # Global: only ONE in_progress regardless of assignment or is_student_practice
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
            TrainingRecord.is_student_practice == True,
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

    config = _stamp_experiment(
        {
            "id": 0,
            "name": case.name,
            "features": assignment.features or {},
            "behavior": assignment.behavior or {},
        }
    )

    # 归档病例不得用于**新的**训练（既有作业也拦，docs/15 §六：archived 只阻止新使用）；
    # 进行中的记录走上面的 existing 分支，不受影响。
    require_publishable(case)
    # 作业钉住的病例版本（发布时固化，列已 NOT NULL）：解析不到就拒绝开始，
    # 不回落病例当前版本 —— 否则同一作业会在不同时间跑在不同内容上。
    revision = require_pinned_revision(db, assignment.case_revision_id, case=case)
    record, greeting = _create_record(
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

    # 随机池只含**可开始**的病例：抽到一条没有学生工作区的 workflow（如 clinical_reasoning）
    # 会让盲盒偶发 409 —— 随机入口只能从真能开始的集合里抽（docs/15 §十六）。
    candidates = (
        db.query(Case).filter(Case.is_open == True, Case.status == CASE_STATUS_PUBLISHED).order_by(func.random()).all()
    )
    case = next((candidate for candidate in candidates if case_is_startable(candidate)), None)
    if case is None:
        raise HTTPException(status_code=400, detail="暂无可用的自主练习病例，请稍后再试")
    revision = require_current_revision(db, case)

    config = _stamp_experiment(
        {
            "id": 0,
            "name": "盲盒训练",
            "features": {},
            "behavior": {"mode": TrainingMode.BLIND_BOX.value},
        }
    )
    record, greeting = _create_record(
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
    return TrainingStartResponse(
        record_id=record.id,
        greeting=greeting,
        case_name="盲盒训练",
        pending_questionnaires=pending_questionnaires,
    )


@router.post("/start-practice", response_model=TrainingStartResponse)
def start_practice_training(
    req: StartPracticeRequest,
    current_user: Annotated[User, Depends(require_permission("training_access"))],
    db: Annotated[Session, Depends(get_db)],
    request: Request,
):
    """复盘后的再练习：同例纠正 / 迁移变式（docs/19 §五）。

    自由再练习不是作业尝试：记录不带 ``assignment_id``，因此既不占作业次数、也不进作业成绩；
    反过来，作业次数限制也不会因为"重练"被绕过 —— 想拿作业成绩仍然只能走作业入口。
    目标病例、钉住的 revision 与"内容是否已更新"都由服务端解析并留痕。
    """
    source = db.query(TrainingRecord).filter(TrainingRecord.id == req.source_record_id).first()
    if not source:
        raise NotFoundError(detail="源训练记录不存在")
    if source.user_id != current_user.id and not current_user.has_permission("score_review"):
        raise AuthError(detail="只能对本人已完成的训练发起再练习", status_code=403)
    if source.status != TrainingStatus.COMPLETED:
        raise HTTPException(
            status_code=409, detail={"code": "source_not_finished", "message": "只有已完成的训练才能重练"}
        )

    try:
        target = resolve_practice_target(
            db,
            source=source,
            kind=req.kind,
            require_current_revision=require_current_revision,
        )
    except PracticeTargetUnavailable as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": exc.reason, "kind": exc.kind, "message": exc.message},
        ) from exc

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
        existing_case = global_existing.case or db.query(Case).filter(Case.id == global_existing.case_id).first()
        raise HTTPException(
            status_code=409,
            detail={
                "code": "existing_training",
                "record_id": global_existing.id,
                "case_name": existing_case.name if existing_case else "未知病例",
                "started_at": global_existing.start_time.isoformat() if global_existing.start_time else None,
            },
        )

    config = _stamp_experiment(_build_config())
    config["name"] = PRACTICE_LABELS.get(req.kind, req.kind)
    entry = practice_snapshot_entry(target)
    config[PRACTICE_FIELD] = entry

    record, greeting = _create_record(
        db,
        current_user.id,
        target.case,
        target.revision.content or {},
        config,
        workflow=workflow_for_case_revision(target.revision),
        revision_id=target.revision.id,
        app_state=request.app.state,
    )

    log.info(
        f"再练习开始: record_id={record.id} kind={req.kind} source_record_id={source.id} target_case_id={target.case.id}",
        extra={
            "user_id": current_user.id,
            "user_role": current_user.role.name if current_user.role else "",
            "action": "training_start_practice",
        },
    )
    return TrainingStartResponse(
        record_id=record.id,
        greeting=greeting,
        case_name=target.case.name,
        pending_questionnaires=count_pending_required(db, current_user.id, target.case.id),
        practice=entry,
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
