"""Assignment management — teacher publish exercises to classes."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload

from core.database import get_db
from core.deps import DbSession
from core.exceptions import AuthError, NotFoundError
from core.security import require_permission
from infrastructure.exporter import ColumnDef, export_response
from models import Assignment, User
from schemas import (
    AssignmentCreateRequest,
    AssignmentDetail,
    AssignmentListItem,
    AssignmentStudentItem,
    AssignmentUpdateRequest,
    DeleteResponse,
    PaginatedResponse,
)
from services.assignment import AssignmentService

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/assignments", tags=["练习发布"])

_AssignmentManager = Annotated[User, Depends(require_permission("assignment_manage"))]


def _list_resp(view) -> AssignmentListItem:
    return AssignmentListItem(
        id=view.id,
        title=view.title,
        practice_name=view.practice_name,
        class_name=view.class_name,
        start_time=view.start_time,
        end_time=view.end_time,
        student_count=view.student_count,
        completed_count=view.completed_count,
        created_at=view.created_at,
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
        practice_id=view.practice_id,
        practice_name=view.practice_name,
        class_id=view.class_id,
        class_name=view.class_name,
        start_time=view.start_time,
        end_time=view.end_time,
        created_at=view.created_at,
        updated_at=view.updated_at,
        student_count=view.student_count,
        completed_count=view.completed_count,
        scored_count=view.scored_count,
        students=[_student_resp(s) for s in view.students],
    )


@router.post("", response_model=AssignmentDetail)
def create_assignment(req: AssignmentCreateRequest, current_user: _AssignmentManager, db: DbSession):
    return _detail_resp(
        AssignmentService(db).create(
            practice_id=req.practice_id,
            class_id=req.class_id,
            title=req.title,
            description=req.description,
            start_time=req.start_time,
            end_time=req.end_time,
            teacher_id=current_user.id,
        )
    )


@router.get("", response_model=PaginatedResponse[AssignmentListItem])
def list_assignments(
    current_user: _AssignmentManager,
    db: DbSession,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    class_id: Annotated[int | None, Query()] = None,
    status: Annotated[str | None, Query(description="active|ended")] = None,
):
    items, total = AssignmentService(db).list_all(
        teacher_id=current_user.id,
        class_id=class_id,
        status=status,
        offset=offset,
        limit=limit,
    )
    return PaginatedResponse(items=[_list_resp(v) for v in items], total=total, offset=offset, limit=limit)


@router.get("/{assignment_id}", response_model=AssignmentDetail)
def get_assignment(assignment_id: str, current_user: _AssignmentManager, db: DbSession):
    return _detail_resp(AssignmentService(db).get(assignment_id, current_user.id))


@router.put("/{assignment_id}", response_model=AssignmentDetail)
def update_assignment(
    assignment_id: str, req: AssignmentUpdateRequest, current_user: _AssignmentManager, db: DbSession
):
    return _detail_resp(
        AssignmentService(db).update(
            assignment_id=assignment_id,
            teacher_id=current_user.id,
            practice_id=req.practice_id,
            class_id=req.class_id,
            title=req.title,
            description=req.description,
            start_time=req.start_time,
            end_time=req.end_time,
        )
    )


@router.delete("/{assignment_id}", response_model=DeleteResponse)
def delete_assignment(assignment_id: str, current_user: _AssignmentManager, db: DbSession):
    return AssignmentService(db).delete(assignment_id, current_user.id)


# ── Export (non-CRUD, kept inline) ──


@router.post("/{assignment_id}/export")
def export_assignment(
    assignment_id: str,
    current_user: Annotated[User, Depends(require_permission("export_data"))],
    db: Annotated[Session, Depends(get_db)],
):
    assignment = (
        db.query(Assignment)
        .options(joinedload(Assignment.practice), joinedload(Assignment.class_))
        .filter(Assignment.id == assignment_id)
        .first()
    )
    if not assignment:
        raise NotFoundError("练习发布不存在")
    if assignment.teacher_id != current_user.id:
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
