"""Assignment management — teacher publish exercises to classes."""

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from core.database import get_db
from core.datetime_utils import ensure_utc
from core.security import get_current_user, require_permission
from core.pagination import paginate
from infrastructure.export import Column, buffered_response
from models import Assignment, Case, Class, Grade, Score, TrainingRecord, User, UserClass
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

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/assignments", tags=["练习发布"])


def _check_teacher_school(db: Session, teacher: User, class_id: int):
    cls = (
        db.query(Class)
        .options(joinedload(Class.grade))
        .filter(Class.id == class_id)
        .first()
    )
    if not cls:
        raise HTTPException(status_code=404, detail="班级不存在")
    if not cls.grade or cls.grade.school_id != teacher.school_id:
        raise HTTPException(status_code=403, detail="无权操作该校班级")
    return cls


def _build_assignment_list_item(a: Assignment, student_count: int = 0, completed_count: int = 0) -> AssignmentListItem:
    return AssignmentListItem(
        id=a.id,
        title=a.title,
        case_name=a.case.name if a.case else "",
        class_name=a.class_.name if a.class_ else "",
        start_time=a.start_time,
        end_time=a.end_time,
        student_count=student_count,
        completed_count=completed_count,
        created_at=a.created_at,
    )


def _build_detail(db: Session, assignment: Assignment) -> AssignmentDetail:
    students_in_class = (
        db.query(User)
        .join(UserClass, UserClass.user_id == User.id)
        .filter(UserClass.class_id == assignment.class_id)
        .all()
    )

    training_records = (
        db.query(TrainingRecord)
        .options(joinedload(TrainingRecord.score))
        .filter(TrainingRecord.assignment_id == assignment.id)
        .all()
    )
    record_by_user: dict[int, TrainingRecord] = {r.user_id: r for r in training_records}

    now = datetime.now(UTC)
    student_items: list[AssignmentStudentItem] = []
    for student in students_in_class:
        record = record_by_user.get(student.id)
        if record:
            student_items.append(AssignmentStudentItem(
                user_id=student.id,
                display_name=student.display_name,
                student_id=student.student_id,
                record_id=record.id,
                status=record.status,
                score_total=record.score.total_score if record.score else None,
                scoring_status=record.scoring_status,
                start_time=record.start_time,
                end_time=record.end_time,
                is_overdue=record.is_overdue,
            ))
        else:
            student_items.append(AssignmentStudentItem(
                user_id=student.id,
                display_name=student.display_name,
                student_id=student.student_id,
                status="not_started",
            ))

    completed_count = sum(1 for s in student_items if s.status == "completed")
    scored_count = sum(1 for s in student_items if s.scoring_status == "completed")

    return AssignmentDetail(
        id=assignment.id,
        title=assignment.title,
        description=assignment.description,
        case_id=assignment.case_id,
        case_name=assignment.case.name if assignment.case else "",
        class_id=assignment.class_id,
        class_name=assignment.class_.name if assignment.class_ else "",
        config_id=assignment.config_id,
        feature_overrides=assignment.feature_overrides,
        start_time=assignment.start_time,
        end_time=assignment.end_time,
        created_at=assignment.created_at,
        updated_at=assignment.updated_at,
        student_count=len(students_in_class),
        completed_count=completed_count,
        scored_count=scored_count,
        students=student_items,
    )


@router.post("", response_model=AssignmentDetail)
def create_assignment(
    req: AssignmentCreateRequest,
    current_user: Annotated[User, Depends(require_permission("score_review"))],
    db: Annotated[Session, Depends(get_db)],
):
    _check_teacher_school(db, current_user, req.class_id)

    case = db.query(Case).filter(Case.id == req.case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")
    if case.school_id is not None and case.school_id != current_user.school_id:
        raise HTTPException(status_code=403, detail="无权使用该校病例")

    if req.end_time <= req.start_time:
        raise HTTPException(status_code=400, detail="截止时间必须晚于开始时间")

    assignment = Assignment(
        case_id=req.case_id,
        class_id=req.class_id,
        teacher_id=current_user.id,
        title=req.title,
        description=req.description,
        config_id=req.config_id,
        feature_overrides=req.feature_overrides,
        start_time=req.start_time,
        end_time=req.end_time,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)

    log.info(f"Assignment created: id={assignment.id} title={assignment.title}", extra={"user_id": current_user.id})
    return _build_detail(db, assignment)


@router.get("", response_model=PaginatedResponse[AssignmentListItem])
def list_assignments(
    current_user: Annotated[User, Depends(require_permission("score_review"))],
    db: Annotated[Session, Depends(get_db)],
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    class_id: Annotated[int | None, Query()] = None,
    status: Annotated[str | None, Query(description="active|ended")] = None,
):
    student_sub = (
        db.query(func.count(TrainingRecord.id))
        .filter(TrainingRecord.assignment_id == Assignment.id)
        .correlate(Assignment)
        .scalar_subquery()
    )
    completed_sub = (
        db.query(func.count(TrainingRecord.id))
        .filter(TrainingRecord.assignment_id == Assignment.id, TrainingRecord.status == "completed")
        .correlate(Assignment)
        .scalar_subquery()
    )

    q = db.query(
        Assignment,
        student_sub.label("student_count"),
        completed_sub.label("completed_count"),
    ).options(
        joinedload(Assignment.case),
        joinedload(Assignment.class_),
    ).filter(Assignment.teacher_id == current_user.id)

    if class_id is not None:
        q = q.filter(Assignment.class_id == class_id)

    now = datetime.now(UTC)
    if status == "active":
        q = q.filter(Assignment.end_time >= now)
    elif status == "ended":
        q = q.filter(Assignment.end_time < now)

    q = q.order_by(Assignment.created_at.desc())
    rows, total = paginate(q, offset, limit)
    items = [_build_assignment_list_item(r[0], student_count=r[1], completed_count=r[2]) for r in rows]
    return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)


@router.get("/{assignment_id}", response_model=AssignmentDetail)
def get_assignment(
    assignment_id: str,
    current_user: Annotated[User, Depends(require_permission("score_review"))],
    db: Annotated[Session, Depends(get_db)],
):
    assignment = (
        db.query(Assignment)
        .options(
            joinedload(Assignment.case),
            joinedload(Assignment.class_),
        )
        .filter(Assignment.id == assignment_id)
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=404, detail="练习发布不存在")
    if assignment.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权查看")
    return _build_detail(db, assignment)


@router.put("/{assignment_id}", response_model=AssignmentDetail)
def update_assignment(
    assignment_id: str,
    req: AssignmentUpdateRequest,
    current_user: Annotated[User, Depends(require_permission("score_review"))],
    db: Annotated[Session, Depends(get_db)],
):
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="练习发布不存在")
    if assignment.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权修改")

    if req.title is not None:
        assignment.title = req.title
    if req.description is not None:
        assignment.description = req.description
    if req.config_id is not None:
        assignment.config_id = req.config_id
    if req.feature_overrides is not None:
        assignment.feature_overrides = req.feature_overrides
    if req.start_time is not None:
        assignment.start_time = req.start_time
    if req.end_time is not None:
        assignment.end_time = req.end_time

    if assignment.end_time <= assignment.start_time:
        raise HTTPException(status_code=400, detail="截止时间必须晚于开始时间")

    assignment.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(assignment)
    return _build_detail(db, assignment)


@router.delete("/{assignment_id}", response_model=DeleteResponse)
def delete_assignment(
    assignment_id: str,
    current_user: Annotated[User, Depends(require_permission("score_review"))],
    db: Annotated[Session, Depends(get_db)],
):
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).with_for_update().first()
    if not assignment:
        raise HTTPException(status_code=404, detail="练习发布不存在")
    if assignment.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权删除")

    started = db.query(TrainingRecord).filter(
        TrainingRecord.assignment_id == assignment_id
    ).with_for_update().first()
    if started:
        raise HTTPException(status_code=400, detail="已有学生开始练习，无法删除")

    db.delete(assignment)
    db.commit()
    return {"message": "练习发布已删除"}


@router.get("/{assignment_id}/export")
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
        raise HTTPException(status_code=404, detail="练习发布不存在")
    if assignment.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权导出")

    records = (
        db.query(TrainingRecord)
        .options(
            joinedload(TrainingRecord.user),
            joinedload(TrainingRecord.score),
        )
        .filter(TrainingRecord.assignment_id == assignment_id)
        .order_by(TrainingRecord.user_id)
        .all()
    )

    columns = [
        Column("学号", lambda r: r.user.student_id if r.user else ""),
        Column("姓名", lambda r: r.user.display_name if r.user else ""),
        Column("状态", lambda r: r.status),
        Column("是否逾期", lambda r: "是" if r.is_overdue else "否"),
        Column("开始时间", lambda r: r.start_time.strftime("%Y-%m-%d %H:%M:%S") if r.start_time else ""),
        Column("结束时间", lambda r: r.end_time.strftime("%Y-%m-%d %H:%M:%S") if r.end_time else ""),
        Column("总分", lambda r: str(r.score.total_score) if r.score and r.score.total_score is not None else ""),
        Column("评分状态", lambda r: r.scoring_status or ""),
    ]

    if any(r.score and r.score.detail_scores for r in records):
        dim_names: list[str] = []
        for r in records:
            if r.score and r.score.detail_scores:
                for dim_name in r.score.detail_scores:
                    if dim_name not in dim_names:
                        dim_names.append(dim_name)
        for dim_name in dim_names:
            columns.append(
                Column(
                    dim_name,
                    lambda r, dn=dim_name: (
                        str(r.score.detail_scores[dn].get("score", ""))
                        if r.score and r.score.detail_scores and dn in r.score.detail_scores
                        else ""
                    ),
                )
            )

    safe_title = assignment.title.replace(" ", "_")[:50]
    return buffered_response(records, columns, f"assignment_{safe_title}_{assignment.id[:8]}.csv")


# ── Student endpoints ──

student_router = APIRouter(prefix="/api/students/assignments", tags=["学生练习"])


@student_router.get("", response_model=list[StudentAssignmentItem])
def list_student_assignments(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    user_class = db.query(UserClass).filter(UserClass.user_id == current_user.id).first()
    if not user_class or not user_class.class_id:
        return []

    now = datetime.now(UTC)
    assignments = (
        db.query(Assignment)
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
        db.query(TrainingRecord)
        .options(joinedload(TrainingRecord.score))
        .filter(
            TrainingRecord.user_id == current_user.id,
            TrainingRecord.assignment_id.in_(assignment_ids),
        )
        .all()
    )
    record_by_assignment: dict[str, TrainingRecord] = {r.assignment_id: r for r in records if r.assignment_id}

    items: list[StudentAssignmentItem] = []
    for a in assignments:
        record = record_by_assignment.get(a.id)
        if record:
            status = record.status
            if status != "completed" and record.is_overdue:
                status = "overdue"
            items.append(StudentAssignmentItem(
                id=a.id,
                title=a.title,
                case_name=a.case.name if a.case else "",
                start_time=a.start_time,
                end_time=a.end_time,
                status=status,
                record_id=record.id,
                score_total=record.score.total_score if record.score else None,
            ))
        else:
            status = "overdue" if now > ensure_utc(a.end_time) else "pending"
            items.append(StudentAssignmentItem(
                id=a.id,
                title=a.title,
                case_name=a.case.name if a.case else "",
                start_time=a.start_time,
                end_time=a.end_time,
                status=status,
            ))

    return items
