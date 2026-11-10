"""Assignment management — teacher publish exercises to classes."""

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session, joinedload

from core.database import get_db
from core.deps import DbSession
from core.exceptions import NotFoundError
from core.security import get_current_user, require_permission
from core.statuses import AssignmentLifecycle, AssignmentProgressStatus
from core.tenant import Scope, TenantScope
from core.time_limits import resolve_time_limit_minutes
from infra.exporter import ColumnDef, ExportAudit, export_response
from models import Assignment, AssignmentRecipient, CaseRevision, TrainingRecord, User
from modules.admin.class_memberships import student_class_ids
from modules.assignments.progress import (
    attempt_from_record,
    count_attempts,
    effective_status,
    pick_representative,
    progress_status,
)
from modules.assignments.service import UNSET, AssignmentService
from modules.training.activities import artifact_definition, resolve_activities
from modules.training.workflows import workflow_for_case_revision
from schemas import (
    AssignmentCreateRequest,
    AssignmentDetail,
    AssignmentListItem,
    AssignmentUpdateRequest,
    DeleteResponse,
    PaginatedResponse,
    StudentAssignmentAttempt,
    StudentAssignmentDetail,
    StudentAssignmentItem,
    StudentRequiredActivity,
    StudentRequiredArtifact,
)


class StudentService:
    """学生自助侧：**不接院校作用域**。

    可见性只由「本人是否仍是该班学生成员」+「发布时固化的受众快照」决定，
    ``user_id`` 一直是本人，所以院校收窄不会减少学生能看到的作业；
    这里刻意不引入 scope，避免给学生的自身路径加一道可能与院校数据不一致的门。
    """

    def __init__(self, db: Session):
        self.db = db

    def _requirements(
        self,
        assignment: Assignment,
    ) -> tuple[list[StudentRequiredActivity], list[StudentRequiredArtifact], int | None]:
        """学生可见的训练要求：预计时限 + 要做的操作 + 必交产物。

        全部**复用已有声明**，不新建平行映射：

        - 时限：作业 ``behavior.time_limit_minutes`` 覆盖病例列，再经
          ``core.time_limits.resolve_time_limit_minutes`` 收敛 —— 与开始训练时的倒计时同源。
        - 操作：``resolve_activities`` 按作业钉住的 revision 解析（workflow 白名单 ∩ 病例声明
          ∩ 作业覆盖），只投影 Activity 登记表里的公开 ``label``。
        - 必交：``WorkflowDefinition.required_artifacts_for``（病例 ``completion`` 声明优先），
          只投影 ``artifact_definition(kind).label``。

        披露边界：不读 ``hidden_info``、不读评分细则、不读 Activity config —— 这些都是教师侧
        或运行期材料，学生判断「要交什么」不需要它们。
        """
        # 作业钉住的版本（不是病例的 current_revision）：学生练的正是发布时冻结的那份内容
        revision = self.db.query(CaseRevision).filter(CaseRevision.id == assignment.case_revision_id).first()
        case_data = revision.content if revision is not None else None
        behavior = assignment.behavior or {}
        features = assignment.features or {}

        if revision is None:
            activities: list[StudentRequiredActivity] = []
            artifacts: list[StudentRequiredArtifact] = []
        else:
            workflow = workflow_for_case_revision(revision)
            activities = [
                StudentRequiredActivity(id=item.definition.id, label=item.definition.label)
                for item in resolve_activities(case_data, allowed=workflow.activities, overrides=features)
                if item.availability.available
            ]
            artifacts = [
                StudentRequiredArtifact(kind=kind, label=definition.label)
                for kind in workflow.required_artifacts_for(case_data)
                if (definition := artifact_definition(kind)) is not None
            ]

        declared_limit = behavior.get("time_limit_minutes") or (
            assignment.case.time_limit_minutes if assignment.case is not None else None
        )
        time_limit = (
            resolve_time_limit_minutes(
                int(declared_limit),
                source="assignment" if behavior.get("time_limit_minutes") else "case",
            )
            if declared_limit is not None
            else None
        )
        return activities, artifacts, time_limit

    def list_assignments(self, user_id: int) -> list[StudentAssignmentItem]:
        # 学生侧可见性 = 当前仍是该班学生成员 ∩ 发布时固化的受众快照。
        # 移出班级立即失去可见性；已发布作业的受众/分母本身不受成员变动影响。
        class_ids = student_class_ids(self.db, user_id)
        if not class_ids:
            return []

        now = datetime.now(UTC)
        assignments = (
            self.db.query(Assignment)
            .options(joinedload(Assignment.case))
            .join(AssignmentRecipient, AssignmentRecipient.assignment_id == Assignment.id)
            .filter(
                AssignmentRecipient.user_id == user_id,
                Assignment.class_id.in_(class_ids),
                Assignment.start_time <= now,
            )
            .order_by(Assignment.end_time.desc())
            .all()
        )

        assignment_ids = [a.id for a in assignments]
        records = (
            self.db.query(TrainingRecord)
            .options(joinedload(TrainingRecord.score))
            .filter(
                TrainingRecord.user_id == user_id,
                TrainingRecord.assignment_id.in_(assignment_ids),
                TrainingRecord.is_student_practice == True,
            )
            .order_by(TrainingRecord.start_time.desc())
            .all()
        )
        records_by_assignment: dict[str, list[TrainingRecord]] = {}
        for r in records:
            if r.assignment_id:
                records_by_assignment.setdefault(r.assignment_id, []).append(r)

        items: list[StudentAssignmentItem] = []
        for a in assignments:
            attempts = [attempt_from_record(r) for r in records_by_assignment.get(a.id, [])]
            representative = pick_representative(attempts)
            closed = effective_status(a.is_closed, a.end_time, now) is AssignmentLifecycle.CLOSED
            hide_case = bool((a.behavior or {}).get("hide_case_info"))

            items.append(
                StudentAssignmentItem(
                    id=a.id,
                    title=a.title,
                    # 与详情同一披露口径：隐藏病例时名称与编号都不下发给学生。
                    case_name="" if hide_case else (a.case.name if a.case else ""),
                    hide_case_info=hide_case,
                    start_time=a.start_time,
                    end_time=a.end_time,
                    status=AssignmentProgressStatus.CLOSED.value if closed else progress_status(representative),
                    record_id=representative.record_id if representative else None,
                    score_total=representative.score if representative else None,
                    scoring_status=representative.scoring_status if representative else None,
                    is_overdue=representative.is_overdue if representative else False,
                    max_attempts=a.max_attempts,
                    attempt_count=count_attempts(attempt.status for attempt in attempts),
                )
            )

        return items

    def get_assignment(self, assignment_id: str, user_id: int) -> StudentAssignmentDetail:
        """学生自己的作业详情 —— 可见性与开始入口同一把门。

        可见 = 仍是该班学生成员 ∩ 发布时的受众快照（与 ``start_training_from_assignment``
        完全一致）。任一不满足一律 404：教别人「你无权查看」等于确认作业存在，
        而作业是按班发布的，被移出班级的学生不该从错误码里读到自己被移出。
        """
        class_ids = student_class_ids(self.db, user_id)
        assignment = (
            self.db.query(Assignment)
            .options(joinedload(Assignment.case), joinedload(Assignment.class_))
            .filter(Assignment.id == assignment_id)
            .first()
        )
        if assignment is None or assignment.class_id not in class_ids:
            raise NotFoundError("作业不存在")
        in_audience = (
            self.db.query(AssignmentRecipient)
            .filter(
                AssignmentRecipient.assignment_id == assignment.id,
                AssignmentRecipient.user_id == user_id,
            )
            .first()
        )
        if in_audience is None:
            raise NotFoundError("作业不存在")

        now = datetime.now(UTC)
        records = (
            self.db.query(TrainingRecord)
            .options(joinedload(TrainingRecord.score))
            .filter(
                TrainingRecord.user_id == user_id,
                TrainingRecord.assignment_id == assignment.id,
                TrainingRecord.is_student_practice == True,
            )
            .order_by(TrainingRecord.start_time.desc())
            .all()
        )

        attempts = [attempt_from_record(record) for record in records]
        representative = pick_representative(attempts)
        lifecycle = effective_status(assignment.is_closed, assignment.end_time, now)
        closed = lifecycle is AssignmentLifecycle.CLOSED
        attempt_count = count_attempts(attempt.status for attempt in attempts)
        limit = assignment.max_attempts
        remaining = None if not limit or limit <= 0 else max(limit - attempt_count, 0)
        required_activities, required_artifacts, time_limit = self._requirements(assignment)

        hide_case = bool((assignment.behavior or {}).get("hide_case_info"))
        return StudentAssignmentDetail(
            id=assignment.id,
            title=assignment.title,
            description=assignment.description,
            case_id=None if hide_case else assignment.case_id,
            # 隐藏病例时连名称都不披露：作业页比训练入口更容易被截图转发
            case_name="" if hide_case else (assignment.case.name if assignment.case else ""),
            hide_case_info=hide_case,
            class_id=assignment.class_id,
            class_name=assignment.class_.name if assignment.class_ else "",
            teacher_name=assignment.teacher.display_name if assignment.teacher else "",
            start_time=assignment.start_time,
            end_time=assignment.end_time,
            lifecycle=lifecycle.value,
            status=AssignmentProgressStatus.CLOSED.value if closed else progress_status(representative),
            mode=str((assignment.behavior or {}).get("mode") or ""),
            max_attempts=assignment.max_attempts,
            attempt_count=attempt_count,
            remaining_attempts=remaining,
            record_id=representative.record_id if representative else None,
            attempts=[
                StudentAssignmentAttempt(
                    record_id=attempt.record_id,
                    status=attempt.status,
                    scoring_status=attempt.scoring_status,
                    score_total=attempt.score,
                    is_overdue=attempt.is_overdue,
                    start_time=attempt.start_time,
                    end_time=attempt.end_time,
                )
                for attempt in attempts
            ],
            time_limit_minutes=time_limit,
            required_activities=required_activities,
            required_artifacts=required_artifacts,
        )


log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/assignments", tags=["练习发布"])

_AssignmentManager = Annotated[User, Depends(require_permission("assignment_manage"))]


def _sees_whole_school(scope: TenantScope) -> bool:
    """无任教班收窄（院校管理员/平台角色）才可越过"必须是发布者"。

    教师只看自己发布的作业；院校边界由 ``AssignmentService`` 统一收窄。
    """
    return scope.class_ids is None


def _detail_resp(view) -> AssignmentDetail:
    """Serialize the service's sole detail view; schemas own field projection."""
    return AssignmentDetail.model_validate(view)


@router.post("", response_model=AssignmentDetail)
def create_assignment(req: AssignmentCreateRequest, current_user: _AssignmentManager, db: DbSession, scope: Scope):
    return _detail_resp(
        AssignmentService(db, scope).create(
            case_id=req.case_id,
            class_id=req.class_id,
            title=req.title,
            description=req.description,
            features=req.features,
            behavior=req.behavior,
            audience_mode=req.audience.mode,
            recipient_user_ids=req.audience.user_ids,
            start_time=req.start_time,
            end_time=req.end_time,
            teacher_id=current_user.id,
            max_attempts=req.max_attempts,
        )
    )


@router.get("", response_model=PaginatedResponse[AssignmentListItem])
def list_assignments(
    current_user: _AssignmentManager,
    db: DbSession,
    scope: Scope,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    class_id: Annotated[int | None, Query()] = None,
    status: Annotated[str | None, Query(description="active|ended")] = None,
):
    # 院校边界由服务层收窄；教师在本校范围内仍只看自己发布的作业
    items, total = AssignmentService(db, scope).list_all(
        teacher_id=None if _sees_whole_school(scope) else current_user.id,
        class_id=class_id,
        status=status,
        offset=offset,
        limit=limit,
    )
    return PaginatedResponse(
        items=[AssignmentListItem.model_validate(v) for v in items], total=total, offset=offset, limit=limit
    )


@router.get("/{assignment_id}", response_model=AssignmentDetail)
def get_assignment(assignment_id: str, current_user: _AssignmentManager, db: DbSession, scope: Scope):
    return _detail_resp(
        AssignmentService(db, scope).get(assignment_id, current_user.id, skip_ownership=_sees_whole_school(scope))
    )


@router.put("/{assignment_id}", response_model=AssignmentDetail)
def update_assignment(
    assignment_id: str,
    req: AssignmentUpdateRequest,
    current_user: _AssignmentManager,
    db: DbSession,
    scope: Scope,
):
    return _detail_resp(
        AssignmentService(db, scope).update(
            assignment_id=assignment_id,
            teacher_id=current_user.id,
            case_id=req.case_id,
            class_id=req.class_id,
            title=req.title,
            description=req.description,
            features=req.features,
            behavior=req.behavior,
            audience_mode=req.audience.mode if req.audience is not None else None,
            recipient_user_ids=req.audience.user_ids if req.audience is not None else None,
            start_time=req.start_time,
            end_time=req.end_time,
            is_closed=req.is_closed,
            # 显式 null = 不限制；请求未带该键 = 不修改
            max_attempts=req.max_attempts if "max_attempts" in req.model_fields_set else UNSET,
            skip_ownership=_sees_whole_school(scope),
        )
    )


@router.delete("/{assignment_id}", response_model=DeleteResponse)
def delete_assignment(assignment_id: str, current_user: _AssignmentManager, db: DbSession, scope: Scope):
    return AssignmentService(db, scope).delete(assignment_id, current_user.id, skip_ownership=_sees_whole_school(scope))


# ── Export ──


@router.post("/{assignment_id}/export")
def export_assignment(
    assignment_id: str,
    current_user: Annotated[User, Depends(require_permission("export_data"))],
    db: Annotated[Session, Depends(get_db)],
    scope: Scope,
    request: Request,
):
    # 可见性与归属校验复用详情口径：跨院校/跨任教班 404，非发布者 403；
    # 明细与文件名都取自同一份 detail，避免两套取数逻辑对不上
    detail = AssignmentService(db, scope).get(assignment_id, current_user.id, skip_ownership=_sees_whole_school(scope))
    students_data = detail.students

    columns: list[ColumnDef] = [
        ColumnDef(header="学号", value=lambda r: r.student_id or ""),
        ColumnDef(header="姓名", value=lambda r: r.display_name),
        ColumnDef(header="状态", value=lambda r: r.status),
        ColumnDef(header="尝试次数", value=lambda r: str(r.attempt_count)),
        ColumnDef(header="是否逾期", value=lambda r: "是" if r.is_overdue else "否"),
        ColumnDef(
            header="开始时间", value=lambda r: r.start_time.strftime("%Y-%m-%d %H:%M:%S") if r.start_time else ""
        ),
        ColumnDef(header="结束时间", value=lambda r: r.end_time.strftime("%Y-%m-%d %H:%M:%S") if r.end_time else ""),
        ColumnDef(
            header="总分",
            value=lambda r: str(r.score_total) if r.score_total is not None else "",
        ),
        ColumnDef(header="评分状态", value=lambda r: r.scoring_status or ""),
    ]

    safe_title = detail.title.replace(" ", "_")[:50]
    return export_response(
        students_data,
        columns,
        filename=f"assignment_{safe_title}_{detail.id[:8]}",
        format="csv",
        audit=ExportAudit(request=request, target_label=f"作业：{detail.title}"),
    )


# ── Student practice ──

student_router = APIRouter(prefix="/api/students/assignments", tags=["学生练习"])


@student_router.get("", response_model=list[StudentAssignmentItem])
def list_student_assignments(current_user: Annotated[User, Depends(get_current_user)], db: DbSession):
    return StudentService(db).list_assignments(current_user.id)


@student_router.get("/{assignment_id}", response_model=StudentAssignmentDetail)
def get_student_assignment(assignment_id: str, current_user: Annotated[User, Depends(get_current_user)], db: DbSession):
    """学生作业详情。

    刻意**不走** ``assignment_manage`` 权限：那是教师发布/编辑作业的门，
    学生看自己被布置的作业不该借用它。可见性由 ``StudentService.get_assignment``
    按成员关系 + 受众快照判定，越界一律 404。
    """
    return StudentService(db).get_assignment(assignment_id, current_user.id)
