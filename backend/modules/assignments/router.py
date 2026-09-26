"""Assignment management — teacher publish exercises to classes."""

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session, joinedload

from core.database import get_db
from core.deps import DbSession
from core.exceptions import AuthError, NotFoundError
from core.security import get_current_user, require_permission
from core.statuses import AssignmentLifecycle, AssignmentProgressStatus
from infra.exporter import ColumnDef, ExportAudit, export_response
from models import Assignment, AssignmentRecipient, TrainingRecord, User
from modules.admin.class_memberships import student_class_ids
from modules.assignments.progress import (
    attempt_from_record,
    count_attempts,
    effective_status,
    pick_representative,
    progress_status,
)
from modules.assignments.service import UNSET, AssignmentService
from schemas import (
    AssignmentCreateRequest,
    AssignmentDetail,
    AssignmentListItem,
    AssignmentUpdateRequest,
    DeleteResponse,
    PaginatedResponse,
    StudentAssignmentItem,
)


class StudentService:
    def __init__(self, db: Session):
        self.db = db

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
                TrainingRecord.is_test == False,
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

            items.append(
                StudentAssignmentItem(
                    id=a.id,
                    title=a.title,
                    case_name=a.case.name if a.case else "",
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


log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/assignments", tags=["练习发布"])

_AssignmentManager = Annotated[User, Depends(require_permission("assignment_manage"))]


def _detail_resp(view) -> AssignmentDetail:
    """Serialize the service's sole detail view; schemas own field projection."""
    return AssignmentDetail.model_validate(view)


@router.post("", response_model=AssignmentDetail)
def create_assignment(req: AssignmentCreateRequest, current_user: _AssignmentManager, db: DbSession):
    return _detail_resp(
        AssignmentService(db).create(
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
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    class_id: Annotated[int | None, Query()] = None,
    status: Annotated[str | None, Query(description="active|ended")] = None,
):
    is_admin = current_user.has_permission("user_manage")
    items, total = AssignmentService(db).list_all(
        teacher_id=None if is_admin else current_user.id,
        class_id=class_id,
        status=status,
        offset=offset,
        limit=limit,
    )
    return PaginatedResponse(
        items=[AssignmentListItem.model_validate(v) for v in items], total=total, offset=offset, limit=limit
    )


@router.get("/{assignment_id}", response_model=AssignmentDetail)
def get_assignment(assignment_id: str, current_user: _AssignmentManager, db: DbSession):
    is_admin = current_user.has_permission("user_manage")
    return _detail_resp(AssignmentService(db).get(assignment_id, current_user.id, skip_ownership=is_admin))


@router.put("/{assignment_id}", response_model=AssignmentDetail)
def update_assignment(
    assignment_id: str, req: AssignmentUpdateRequest, current_user: _AssignmentManager, db: DbSession
):
    is_admin = current_user.has_permission("user_manage")
    return _detail_resp(
        AssignmentService(db).update(
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
            skip_ownership=is_admin,
        )
    )


@router.delete("/{assignment_id}", response_model=DeleteResponse)
def delete_assignment(assignment_id: str, current_user: _AssignmentManager, db: DbSession):
    is_admin = current_user.has_permission("user_manage")
    return AssignmentService(db).delete(assignment_id, current_user.id, skip_ownership=is_admin)


# ── Export ──


@router.post("/{assignment_id}/export")
def export_assignment(
    assignment_id: str,
    current_user: Annotated[User, Depends(require_permission("export_data"))],
    db: Annotated[Session, Depends(get_db)],
    request: Request,
):
    assignment = (
        db.query(Assignment)
        .options(joinedload(Assignment.case), joinedload(Assignment.class_))
        .filter(Assignment.id == assignment_id)
        .first()
    )
    if not assignment:
        raise NotFoundError("练习发布不存在")
    if assignment.teacher_id != current_user.id and not current_user.has_permission("user_manage"):
        raise AuthError("无权导出", status_code=403)

    service = AssignmentService(db)
    detail = service._build_detail_view(assignment)
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

    safe_title = assignment.title.replace(" ", "_")[:50]
    return export_response(
        students_data,
        columns,
        filename=f"assignment_{safe_title}_{assignment.id[:8]}",
        format="csv",
        audit=ExportAudit(request=request, target_label=f"作业：{assignment.title}"),
    )


# ── Student practice ──

student_router = APIRouter(prefix="/api/students/assignments", tags=["学生练习"])


@student_router.get("", response_model=list[StudentAssignmentItem])
def list_student_assignments(current_user: Annotated[User, Depends(get_current_user)], db: DbSession):
    return StudentService(db).list_assignments(current_user.id)
