"""Assignment management — teacher publish exercises to classes."""

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload

from core.database import get_db
from core.datetime_utils import ensure_utc
from core.deps import DbSession
from core.exceptions import AuthError, NotFoundError
from core.security import get_current_user, require_permission
from infra.exporter import ColumnDef, export_response
from models import Assignment, TrainingRecord, User, UserClass
from modules.assignments.service import AssignmentService
from schemas import (
    AssignmentCreateRequest,
    AssignmentDetail,
    AssignmentListItem,
    AssignmentStudentItem,
    AssignmentUpdateRequest,
    DeleteResponse,
    PaginatedResponse,
    StudentAssignmentItem,
)


class StudentService:
    def __init__(self, db: Session):
        self.db = db

    def list_assignments(self, user_id: int) -> list[StudentAssignmentItem]:
        user_class = self.db.query(UserClass).filter(UserClass.user_id == user_id).first()
        if not user_class or not user_class.class_id:
            return []

        now = datetime.now(UTC)
        assignments = (
            self.db.query(Assignment)
            .options(joinedload(Assignment.case))
            .filter(
                Assignment.class_id == user_class.class_id,
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
            if a.student_ids is not None and user_id not in a.student_ids:
                continue

            case_name = a.case.name if a.case else ""
            user_records = records_by_assignment.get(a.id, [])
            attempt_count = sum(1 for r in user_records if r.status != "in_progress")

            end_time = ensure_utc(a.end_time)
            if a.is_closed or now > end_time:
                items.append(
                    StudentAssignmentItem(
                        id=a.id,
                        title=a.title,
                        case_name=case_name,
                        start_time=a.start_time,
                        end_time=a.end_time,
                        status="closed",
                        max_attempts=a.max_attempts,
                        attempt_count=attempt_count,
                    )
                )
                continue

            if user_records:
                record = user_records[0]
                status = record.status
                if status != "completed" and record.is_overdue:
                    status = "overdue"
                items.append(
                    StudentAssignmentItem(
                        id=a.id,
                        title=a.title,
                        case_name=case_name,
                        start_time=a.start_time,
                        end_time=a.end_time,
                        status=status,
                        record_id=record.id,
                        score_total=record.score.total_score if record.score else None,
                        is_overdue=record.is_overdue,
                        max_attempts=a.max_attempts,
                        attempt_count=attempt_count,
                    )
                )
            else:
                items.append(
                    StudentAssignmentItem(
                        id=a.id,
                        title=a.title,
                        case_name=case_name,
                        start_time=a.start_time,
                        end_time=a.end_time,
                        status="pending",
                        max_attempts=a.max_attempts,
                        attempt_count=attempt_count,
                    )
                )

        return items

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/assignments", tags=["练习发布"])

_AssignmentManager = Annotated[User, Depends(require_permission("assignment_manage"))]


def _list_resp(view) -> AssignmentListItem:
    return AssignmentListItem(
        id=view.id,
        title=view.title,
        case_name=view.case_name,
        class_name=view.class_name,
        teacher_name=view.teacher_name,
        start_time=view.start_time,
        end_time=view.end_time,
        student_count=view.student_count,
        completed_count=view.completed_count,
        created_at=view.created_at,
        is_closed=view.is_closed,
    )


def _student_resp(view) -> AssignmentStudentItem:
    return AssignmentStudentItem(
        user_id=view.user_id,
        display_name=view.display_name,
        student_id=view.student_id,
        record_id=view.record_id,
        status=view.status,
        score_total=view.score_total,
        scoring_status=view.scoring_status,
        start_time=view.start_time,
        end_time=view.end_time,
        is_overdue=view.is_overdue,
        attempt_count=view.attempt_count,
    )


def _detail_resp(view) -> AssignmentDetail:
    return AssignmentDetail(
        id=view.id,
        title=view.title,
        description=view.description,
        case_id=view.case_id,
        case_name=view.case_name,
        class_id=view.class_id,
        class_name=view.class_name,
        features=view.features,
        behavior=view.behavior,
        student_ids=view.student_ids,
        start_time=view.start_time,
        end_time=view.end_time,
        created_at=view.created_at,
        updated_at=view.updated_at,
        student_count=view.student_count,
        completed_count=view.completed_count,
        scored_count=view.scored_count,
        avg_score=view.avg_score,
        max_score=view.max_score,
        min_score=view.min_score,
        completion_rate=view.completion_rate,
        students=[_student_resp(s) for s in view.students],
        max_attempts=view.max_attempts,
    )


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
            student_ids=req.student_ids,
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
    return PaginatedResponse(items=[_list_resp(v) for v in items], total=total, offset=offset, limit=limit)


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
            student_ids=req.student_ids,
            start_time=req.start_time,
            end_time=req.end_time,
            is_closed=req.is_closed,
            max_attempts=req.max_attempts,
            skip_ownership=is_admin,
        )
    )


@router.delete("/{assignment_id}", response_model=DeleteResponse)
def delete_assignment(assignment_id: str, current_user: _AssignmentManager, db: DbSession):
    is_admin = current_user.has_permission("user_manage")
    return AssignmentService(db).delete(assignment_id, current_user.id, skip_ownership=is_admin)


@router.post("/{assignment_id}/remind")
def remind_assignment(assignment_id: str, current_user: _AssignmentManager, db: DbSession):
    is_admin = current_user.has_permission("user_manage")
    return AssignmentService(db).send_reminder(assignment_id, current_user.id, skip_ownership=is_admin)


# ── Export ──


@router.post("/{assignment_id}/export")
def export_assignment(
    assignment_id: str,
    current_user: Annotated[User, Depends(require_permission("export_data"))],
    db: Annotated[Session, Depends(get_db)],
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
        students_data, columns, filename=f"assignment_{safe_title}_{assignment.id[:8]}", format="csv"
    )

# ── Student practice ──

student_router = APIRouter(prefix="/api/students/assignments", tags=["学生练习"])


@student_router.get("", response_model=list[StudentAssignmentItem])
def list_student_assignments(current_user: Annotated[User, Depends(get_current_user)], db: DbSession):
    return StudentService(db).list_assignments(current_user.id)
