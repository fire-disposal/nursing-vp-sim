import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from core.deps import DbSession
from core.security import require_permission
from infrastructure.exporter import ColumnDef, export_response
from models import User
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
    from core.config import MAX_EXPORT_ROWS

    users = db.query(User).order_by(User.created_at.desc()).limit(MAX_EXPORT_ROWS + 1).all()
    columns = [
        ColumnDef("用户名", key="username"),
        ColumnDef("姓名", key="display_name"),
        ColumnDef("学号", key="student_id"),
        ColumnDef("角色", value=lambda u: u.role.name if u.role else ""),
    ]
    return export_response(users, columns, "用户列表", "用户列表", format)


@router.put("/users/{user_id}", response_model=UserBrief)
def update_user(user_id: int, req: UserUpdateRequest, current_user: _Manager, db: DbSession):
    view = UserService(db).update(user_id, req, current_user=current_user)
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
    result = UserService(db).batch_create([u.model_dump() for u in users])
    log.info(
        f"批量导入: created={result['created']} skipped={result['skipped']}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )
    return result


@router.get("/stats", response_model=AdminStats)
def get_stats(current_user: Annotated[User, Depends(require_permission("stats_view"))], db: DbSession):
    return UserService(db).get_stats()
