import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func

from core.config import BATCH_USER_LIMIT
from core.deps import DbSession
from core.exceptions import ValidationError
from core.security import hash_password, require_permission
from infrastructure.exporter import ColumnDef, export_response
from models import Class, Role, Score, TrainingRecord, User, UserClass
from schemas import (
    AdminStats,
    BatchCreateResult,
    BatchUserItem,
    DeleteResponse,
    PaginatedResponse,
    StudentDetail,
    TrainingRecordBrief,
    UserBrief,
    UserUpdateRequest,
)
from services.user import StudentDetailView, UserBriefView, UserService

log = logging.getLogger(__name__)

router = APIRouter()

_Manager = Annotated[User, Depends(require_permission("user_manage"))]


def _brief(v: UserBriefView) -> UserBrief:
    return UserBrief(
        id=v.id,
        username=v.username,
        role=v.role,
        role_display_name=v.role_display_name,
        display_name=v.display_name,
        student_id=v.student_id,
        gender=v.gender,
        avatar=v.avatar,
        created_at=v.created_at,
        class_id=v.class_id,
        class_name=v.class_name,
        grade_name=v.grade_name,
    )


def _detail(v: StudentDetailView) -> StudentDetail:
    return StudentDetail(
        id=v.id,
        username=v.username,
        role=v.role,
        display_name=v.display_name,
        student_id=v.student_id,
        created_at=v.created_at,
        total_sessions=v.total_sessions,
        total_minutes=v.total_minutes,
        avg_score=v.avg_score,
        recent_records=[
            TrainingRecordBrief(
                id=r.id,
                case_id=r.case_id,
                case_name=r.case_name,
                user_display_name=r.user_display_name,
                user_student_id=r.user_student_id,
                status=r.status,
                scoring_status=r.scoring_status,
                scoring_error=r.scoring_error,
                start_time=r.start_time,
                end_time=r.end_time,
                score_total=r.score_total,
            )
            for r in v.recent_records
        ],
        daily=v.daily,
    )


@router.get("/users", response_model=PaginatedResponse[UserBrief])
def list_users(
    current_user: _Manager,
    db: DbSession,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    search: Annotated[str | None, Query(description="搜索用户名/姓名/学号")] = None,
    role: Annotated[str | None, Query(description="角色筛选 student/teacher")] = None,
    class_id: Annotated[int | None, Query()] = None,
    grade_id: Annotated[int | None, Query()] = None,
):
    view = UserService(db).list(
        offset=offset, limit=limit, search=search, role=role, class_id=class_id, grade_id=grade_id
    )
    return PaginatedResponse(
        items=[_brief(v) for v in view.items], total=view.total, offset=view.offset, limit=view.limit
    )


@router.post("/export")
def export_users(
    current_user: _Manager,
    db: DbSession,
    format: str = Query("csv", pattern="^(csv|xlsx)$"),
):
    users = db.query(User).order_by(User.created_at.desc()).all()
    columns = [
        ColumnDef("用户名", key="username"),
        ColumnDef("姓名", key="display_name"),
        ColumnDef("学号", key="student_id"),
        ColumnDef("角色", value=lambda u: u.role.name if u.role else ""),
    ]
    return export_response(users, columns, "用户列表", "用户列表", format)


@router.put("/users/{user_id}", response_model=UserBrief)
def update_user(user_id: int, req: UserUpdateRequest, current_user: _Manager, db: DbSession):
    view = UserService(db).update(user_id, req)
    log.info(
        f"用户更新: target_id={user_id} target_name={view.username}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )
    return _brief(view)


@router.get("/users/{user_id}", response_model=StudentDetail)
def get_user_detail(user_id: int, current_user: _Manager, db: DbSession):
    return _detail(UserService(db).get_detail(user_id))


@router.delete("/users/{user_id}", response_model=DeleteResponse)
def delete_user(user_id: int, current_user: _Manager, db: DbSession):
    target_name = UserService(db).delete(user_id, current_user.id)
    log.info(
        f"用户删除: target_id={user_id} target_name={target_name}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )
    return {"message": "用户已删除"}


# ── Non-CRUD endpoints (kept inline: distinct shapes) ──


@router.post("/users/batch", response_model=BatchCreateResult)
def batch_create_users(users: list[BatchUserItem], current_user: _Manager, db: DbSession):
    created = 0
    skipped = 0
    errors = []

    if len(users) > BATCH_USER_LIMIT:
        raise ValidationError(f"单次最多导入 {BATCH_USER_LIMIT} 个用户，当前 {len(users)} 个")

    class_ids = {u.class_id for u in users if u.class_id}
    valid_class_ids = {c.id for c in db.query(Class).filter(Class.id.in_(class_ids)).all()} if class_ids else set()

    for i, u in enumerate(users, 1):
        if not u.username.strip() or not u.password or not u.display_name.strip():
            errors.append(f"第{i}行跳过: 用户名/密码/姓名不能为空")
            skipped += 1
            continue
        if len(u.password) < 6:
            errors.append(f"第{i}行跳过 {u.username}: 密码长度不能少于6位")
            skipped += 1
            continue
        existing = db.query(User).filter(User.username == u.username).first()
        if existing:
            errors.append(f"第{i}行跳过 {u.username}: 用户名已存在")
            skipped += 1
            continue
        if u.class_id and u.class_id not in valid_class_ids:
            errors.append(f"第{i}行跳过 {u.username}: 班级ID {u.class_id} 不存在")
            skipped += 1
            continue
        if u.role not in ("student", "teacher"):
            errors.append(f"第{i}行跳过 {u.username}: 仅支持创建 student/teacher 角色")
            skipped += 1
            continue
        role_obj = db.query(Role).filter(Role.name == u.role).first()
        if not role_obj:
            errors.append(f"第{i}行跳过 {u.username}: 角色 {u.role} 不存在")
            skipped += 1
            continue
        user = User(
            username=u.username,
            password_hash=hash_password(u.password),
            display_name=u.display_name,
            role_id=role_obj.id,
            student_id=u.student_id or None,
        )
        db.add(user)
        db.flush()
        if u.class_id:
            db.add(UserClass(user_id=user.id, class_id=u.class_id))
        created += 1
        if created % 50 == 0:
            db.commit()
    db.commit()
    log.info(
        f"批量导入: created={created} skipped={skipped}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )
    return {"created": created, "skipped": skipped, "errors": errors}


@router.get("/stats", response_model=AdminStats)
def get_stats(current_user: Annotated[User, Depends(require_permission("stats_view"))], db: DbSession):
    student_role_id = None
    student_role = db.query(Role).filter(Role.name == "student").first()
    if student_role:
        student_role_id = student_role.id
    if student_role_id:
        q = db.query(User).filter(User.role_id == student_role_id)
        total_students = q.count()
    else:
        total_students = 0

    q = db.query(TrainingRecord).join(User)
    total_records = q.count()

    q = db.query(TrainingRecord).join(User).filter(TrainingRecord.status == "completed")
    completed_records = q.count()

    q = (
        db.query(func.avg(Score.total_score))
        .join(TrainingRecord, Score.record_id == TrainingRecord.id)
        .join(User, TrainingRecord.user_id == User.id)
    )
    avg_score = q.scalar()

    q = (
        db.query(func.avg(func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60))
        .join(User, TrainingRecord.user_id == User.id)
        .filter(
            TrainingRecord.status == "completed",
            TrainingRecord.end_time.isnot(None),
            TrainingRecord.start_time.isnot(None),
        )
    )
    avg_duration = q.scalar()

    today_start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    q = (
        db.query(func.count(TrainingRecord.id))
        .join(User, TrainingRecord.user_id == User.id)
        .filter(TrainingRecord.start_time >= today_start)
    )
    today_records = q.scalar() or 0

    return AdminStats(
        total_students=total_students,
        total_records=total_records,
        completed_records=completed_records,
        average_score=round(float(avg_score), 1) if avg_score else None,
        avg_duration_min=round(float(avg_duration), 1) if avg_duration else None,
        today_records=today_records,
    )
