"""Admin user management — router + service."""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func as sa_func, or_
from sqlalchemy.orm import Session, joinedload

from core.config import BATCH_USER_LIMIT, MAX_EXPORT_ROWS
from core.deps import DbSession
from core.exceptions import NotFoundError, ValidationError
from core.security import hash_password, require_permission
from core.unit_of_work import unit_of_work
from infra.exporter import ColumnDef, export_response
from models import Class, Role, Score, TrainingRecord, User, UserClass
from models.school import Grade
from schemas import (
    AdminStats,
    BatchCreateResult,
    BatchUserItem,
    BulkAssignClassRequest,
    BulkAssignClassResult,
    DeleteResponse,
    PaginatedResponse,
    StudentDetail,
    TrainingRecordBrief,
    UserBrief,
    UserUpdateRequest,
)

log = logging.getLogger(__name__)

_DETAIL_RECENT_LIMIT = 20
_DETAIL_DAYS = 30


@dataclass
class UserBriefView:
    id: int
    username: str
    role: str
    role_display_name: str
    display_name: str
    student_id: str | None
    gender: str | None
    avatar: str | None
    created_at: datetime
    class_id: int | None
    class_name: str | None
    grade_name: str | None


@dataclass
class PaginatedUsersView:
    items: list[UserBriefView]
    total: int
    offset: int
    limit: int


@dataclass
class RecordBriefView:
    id: int
    case_id: int
    case_name: str
    user_display_name: str
    user_student_id: str | None
    status: str
    scoring_status: str | None
    scoring_error: str | None
    start_time: datetime
    end_time: datetime | None
    score_total: float | None
    assignment_id: str | None = None
    assignment_title: str | None = None


@dataclass
class StudentDetailView:
    id: int
    username: str
    role: str
    display_name: str
    student_id: str | None
    created_at: datetime
    total_sessions: int
    total_minutes: int
    avg_score: float | None
    recent_records: list[RecordBriefView]
    daily: list[dict]


class UserService:
    def __init__(self, db: Session):
        self.db = db

    def _brief(self, user: User) -> UserBriefView:
        ucs = user.user_classes
        uc = ucs[0] if ucs else None
        cls = uc.class_ if uc else None
        return UserBriefView(
            id=user.id,
            username=user.username,
            role=user.role.name if user.role else "",
            role_display_name=user.role.display_name if user.role else "",
            display_name=user.display_name,
            student_id=user.student_id,
            gender=user.gender,
            avatar=user.avatar,
            created_at=user.created_at,
            class_id=cls.id if cls else None,
            class_name=cls.name if cls else None,
            grade_name=cls.grade.name if (cls and cls.grade) else None,
        )

    def list_all(
        self,
        *,
        offset: int,
        limit: int,
        search: str | None,
        role: str | None,
        class_id: int | None,
        grade_id: int | None,
    ) -> PaginatedUsersView:
        role_id: int | None = None
        if role:
            role_obj = self.get_role_by_name(role)
            role_id = role_obj.id if role_obj else -1
        total, users = self.list_paginated(
            offset=offset,
            limit=limit,
            search=search,
            role_id=role_id,
            class_id=class_id,
            grade_id=grade_id,
        )
        return PaginatedUsersView(
            items=[self._brief(u) for u in users],
            total=total,
            offset=offset,
            limit=limit,
        )

    def update(self, user_id: int, req: UserUpdateRequest, current_user: User | None = None) -> UserBriefView:
        user = self.get_with_relations(user_id)
        if not user:
            raise NotFoundError("用户不存在")
        with unit_of_work(self.db):
            if req.display_name is not None:
                user.display_name = req.display_name
            if req.student_id is not None:
                user.student_id = req.student_id or None
            if req.role is not None:
                if current_user and current_user.id == user_id:
                    raise ValidationError("不能修改自己的角色")
                role_obj = self.get_role_by_name(req.role)
                if not role_obj:
                    raise ValidationError("角色不存在")
                user.role_id = role_obj.id
            if req.password is not None and req.password:
                if len(req.password) < 6:
                    raise ValidationError("密码长度不能少于6位")
                user.password_hash = hash_password(req.password)
            if req.gender is not None:
                user.gender = req.gender or None
            if req.avatar is not None:
                user.avatar = req.avatar or None
            if req.class_id is not None:
                if req.class_id != 0:
                    cls = self.get_class(req.class_id)
                    if not cls:
                        raise ValidationError("班级不存在")
                uc = self.get_user_class(user_id)
                if req.class_id == 0:
                    if uc:
                        self.db.delete(uc)
                else:
                    if not uc:
                        uc = UserClass(user_id=user_id)
                        self.db.add(uc)
                    uc.class_id = req.class_id
        self.db.refresh(user)
        return self._brief(user)

    def delete(self, user_id: int, current_user_id: int) -> str:
        if user_id == current_user_id:
            raise ValidationError("不能删除自己")
        user = self.db.get(User, user_id)
        if not user:
            raise NotFoundError("用户不存在")
        record_count = self.record_count(user_id)
        if record_count > 0:
            raise ValidationError(f"该用户有 {record_count} 条训练记录，无法删除。请先删除相关训练记录。")
        target_name = user.username
        with unit_of_work(self.db):
            self.db.delete(user)
            self.db.flush()
        return target_name

    def get_detail(self, user_id: int) -> StudentDetailView:
        user = self.get_with_role(user_id)
        if not user:
            raise NotFoundError("用户不存在")
        since = datetime.now(UTC) - timedelta(days=_DETAIL_DAYS)

        stats = self.training_summary(user_id)
        total_sessions = int(stats.total_sessions or 0) if stats else 0
        total_minutes = round(float(stats.total_minutes or 0)) if stats else 0
        avg_score = round(float(stats.avg_score), 1) if stats and stats.avg_score else None

        daily = [
            {
                "date": str(r.d),
                "sessions": r.sessions,
                "minutes": round(float(r.minutes or 0), 1),
                "avg_score": round(float(r.avg_score), 1) if r.avg_score is not None else None,
            }
            for r in self.daily_stats(user_id, since)
        ]

        recent_records = [
            RecordBriefView(
                id=r.id,
                case_id=r.case_id,
                case_name=r.case.name if r.case else "",
                user_display_name=user.display_name,
                user_student_id=user.student_id,
                status=r.status,
                scoring_status=r.scoring_status,
                scoring_error=r.scoring_error,
                start_time=r.start_time,
                end_time=r.end_time,
                score_total=r.score.total_score if r.score else None,
                assignment_id=r.assignment_id,
                assignment_title=r.assignment.title if r.assignment else None,
            )
            for r in self.recent_records(user_id, _DETAIL_RECENT_LIMIT)
        ]

        return StudentDetailView(
            id=user.id,
            username=user.username,
            role=user.role.name if user.role else "",
            display_name=user.display_name,
            student_id=user.student_id,
            created_at=user.created_at,
            total_sessions=total_sessions,
            total_minutes=total_minutes,
            avg_score=avg_score,
            recent_records=recent_records,
            daily=daily,
        )

    def get_stats(self) -> AdminStats:
        student_role = self.db.query(Role).filter(Role.name == "student").first()
        total_students = 0
        if student_role:
            total_students = self.db.query(User).filter(User.role_id == student_role.id).count()

        base = self.db.query(TrainingRecord).join(User).filter(TrainingRecord.is_test == False)
        total_records = base.count()
        completed_records = base.filter(TrainingRecord.status == "completed").count()
        avg_score = (
            self.db.query(sa_func.avg(Score.total_score))
            .join(TrainingRecord, Score.record_id == TrainingRecord.id)
            .join(User, TrainingRecord.user_id == User.id)
            .filter(TrainingRecord.is_test == False)
            .scalar()
        )
        avg_duration = (
            self.db.query(
                sa_func.avg(sa_func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60)
            )
            .join(User, TrainingRecord.user_id == User.id)
            .filter(
                TrainingRecord.status == "completed",
                TrainingRecord.end_time.isnot(None),
                TrainingRecord.start_time.isnot(None),
                TrainingRecord.is_test == False,
            )
            .scalar()
        )
        today_start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        today_records = (
            self.db.query(sa_func.count(TrainingRecord.id))
            .join(User, TrainingRecord.user_id == User.id)
            .filter(TrainingRecord.start_time >= today_start, TrainingRecord.is_test == False)
            .scalar()
            or 0
        )

        return AdminStats(
            total_students=total_students,
            total_records=total_records,
            completed_records=completed_records,
            average_score=round(float(avg_score), 1) if avg_score else None,
            avg_duration_min=round(float(avg_duration), 1) if avg_duration else None,
            today_records=today_records,
        )

    def batch_create(self, users_data: list[dict]) -> BatchCreateResult:
        if len(users_data) > BATCH_USER_LIMIT:
            raise ValidationError(f"单次最多导入 {BATCH_USER_LIMIT} 个用户，当前 {len(users_data)} 个")

        class_name_map: dict[str, int] = {}
        for u in users_data:
            cn = (u.get("class_name") or "").strip()
            if cn and not u.get("class_id"):
                if cn in class_name_map:
                    u["class_id"] = class_name_map[cn]
                else:
                    existing = self.db.query(Class).filter(Class.name == cn).first()
                    if existing:
                        class_name_map[cn] = existing.id
                        u["class_id"] = existing.id
                    else:
                        grade = self.db.query(Grade).filter(Grade.name == "默认").first()
                        if not grade:
                            grade = Grade(name="默认")
                            self.db.add(grade)
                            self.db.flush()
                        cls = Class(name=cn, grade_id=grade.id)
                        self.db.add(cls)
                        self.db.flush()
                        class_name_map[cn] = cls.id
                        u["class_id"] = cls.id

        class_ids = {u.get("class_id") for u in users_data if u.get("class_id")}
        valid_class_ids = (
            {c.id for c in self.db.query(Class).filter(Class.id.in_(class_ids)).all()} if class_ids else set()
        )

        created = 0
        skipped = 0
        errors: list[str] = []

        for i, u in enumerate(users_data, 1):
            username = (u.get("username") or "").strip()
            password = u.get("password") or ""
            display_name = (u.get("display_name") or "").strip()

            if not username or not password or not display_name:
                errors.append(f"第{i}行跳过: 用户名/密码/姓名不能为空")
                skipped += 1
                continue
            if len(password) < 6:
                errors.append(f"第{i}行跳过 {username}: 密码长度不能少于6位")
                skipped += 1
                continue
            existing = self.db.query(User).filter(User.username == username).first()
            if existing:
                errors.append(f"第{i}行跳过 {username}: 用户名已存在")
                skipped += 1
                continue
            class_id = u.get("class_id")
            if class_id and class_id not in valid_class_ids:
                errors.append(f"第{i}行跳过 {username}: 班级ID {class_id} 不存在")
                skipped += 1
                continue
            role_name = u.get("role", "")
            if role_name != "student":
                errors.append(f"第{i}行跳过 {username}: 批量导入仅支持学生角色")
                skipped += 1
                continue
            role_obj = self.db.query(Role).filter(Role.name == role_name).first()
            if not role_obj:
                errors.append(f"第{i}行跳过 {username}: 角色 {role_name} 不存在")
                skipped += 1
                continue
            user = User(
                username=username,
                password_hash=hash_password(password),
                display_name=display_name,
                role_id=role_obj.id,
                student_id=u.get("student_id") or None,
            )
            self.db.add(user)
            self.db.flush()
            if class_id:
                self.db.add(UserClass(user_id=user.id, class_id=class_id))
            created += 1
        try:
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        return BatchCreateResult(created=created, skipped=skipped, errors=errors)

    def bulk_assign_class(self, user_ids: list[int], class_id: int) -> BulkAssignClassResult:
        target_class = self.get_class(class_id)
        if not target_class:
            raise NotFoundError("班级不存在")

        assigned = 0
        skipped = 0
        errors: list[str] = []

        with unit_of_work(self.db, conflict_detail="操作冲突，请重试"):
            for uid in user_ids:
                user_obj = self.db.get(User, uid)
                if not user_obj:
                    skipped += 1
                    continue
                try:
                    uc = self.get_user_class(uid)
                    if uc:
                        uc.class_id = class_id
                    else:
                        self.db.add(UserClass(user_id=uid, class_id=class_id))
                    assigned += 1
                except Exception:
                    errors.append(f"用户 {uid} 分配失败")

        return BulkAssignClassResult(assigned=assigned, skipped=skipped, errors=errors)

    def get_by_username(self, username: str) -> User | None:
        return self.db.query(User).filter(User.username == username).first()

    def get_with_relations(self, user_id: int) -> User | None:
        return (
            self.db.query(User)
            .options(
                joinedload(User.role),
                joinedload(User.user_classes).joinedload(UserClass.class_).joinedload(Class.grade),
            )
            .filter(User.id == user_id)
            .first()
        )

    def get_with_role(self, user_id: int) -> User | None:
        return self.db.query(User).options(joinedload(User.role)).filter(User.id == user_id).first()

    def get_role_by_name(self, name: str) -> Role | None:
        return self.db.query(Role).filter(Role.name == name).first()

    def get_class(self, class_id: int) -> Class | None:
        return self.db.query(Class).filter(Class.id == class_id).first()

    def get_user_class(self, user_id: int) -> UserClass | None:
        return self.db.query(UserClass).filter(UserClass.user_id == user_id).first()

    def create(self, **kwargs) -> User:
        user = User(**kwargs)
        self.db.add(user)
        self.db.flush()
        return user

    def list_paginated(
        self,
        *,
        offset: int,
        limit: int,
        search: str | None,
        role_id: int | None,
        class_id: int | None,
        grade_id: int | None,
    ) -> tuple[int, list[User]]:
        q = self.db.query(User)
        if class_id is not None or grade_id is not None:
            q = q.join(UserClass, UserClass.user_id == User.id, isouter=True)
            if class_id is not None:
                q = q.filter(UserClass.class_id == class_id)
            elif grade_id is not None:
                q = q.join(Class, Class.id == UserClass.class_id)
                q = q.filter(Class.grade_id == grade_id)
        if search:
            term = f"%{search}%"
            q = q.filter(
                or_(
                    User.username.ilike(term),
                    User.display_name.ilike(term),
                    User.student_id.ilike(term),
                )
            )
        if role_id is not None:
            q = q.filter(User.role_id == role_id)
        total = q.count()
        users = (
            q.options(
                joinedload(User.role),
                joinedload(User.user_classes).joinedload(UserClass.class_).joinedload(Class.grade),
            )
            .order_by(User.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
        return total, users

    def record_count(self, user_id: int) -> int:
        return self.db.query(sa_func.count(TrainingRecord.id)).filter(TrainingRecord.user_id == user_id).scalar() or 0

    def training_summary(self, user_id: int):
        return (
            self.db.query(
                sa_func.count(TrainingRecord.id).label("total_sessions"),
                sa_func.coalesce(
                    sa_func.sum(sa_func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60),
                    0,
                ).label("total_minutes"),
                sa_func.coalesce(sa_func.avg(Score.total_score), 0).label("avg_score"),
            )
            .outerjoin(Score, Score.record_id == TrainingRecord.id)
            .filter(
                TrainingRecord.user_id == user_id,
                TrainingRecord.status == "completed",
            )
            .first()
        )

    def daily_stats(self, user_id: int, since: datetime):
        return (
            self.db.query(
                sa_func.date(TrainingRecord.start_time).label("d"),
                sa_func.count().label("sessions"),
                sa_func.sum(sa_func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60).label(
                    "minutes"
                ),
                sa_func.avg(Score.total_score).label("avg_score"),
            )
            .outerjoin(Score, Score.record_id == TrainingRecord.id)
            .filter(
                TrainingRecord.user_id == user_id,
                TrainingRecord.status == "completed",
                TrainingRecord.start_time >= since,
            )
            .group_by(sa_func.date(TrainingRecord.start_time))
            .order_by("d")
            .all()
        )

    def recent_records(self, user_id: int, limit: int) -> list[TrainingRecord]:
        return (
            self.db.query(TrainingRecord)
            .options(
                joinedload(TrainingRecord.case),
                joinedload(TrainingRecord.score),
                joinedload(TrainingRecord.assignment),
            )
            .filter(TrainingRecord.user_id == user_id)
            .order_by(TrainingRecord.start_time.desc())
            .limit(limit)
            .all()
        )


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
                assignment_id=r.assignment_id,
                assignment_title=r.assignment_title,
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
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    search: Annotated[str | None, Query(description="搜索用户名/姓名/学号")] = None,
    role: Annotated[str | None, Query(description="角色筛选 student/teacher")] = None,
    class_id: Annotated[int | None, Query()] = None,
    grade_id: Annotated[int | None, Query()] = None,
):
    view = UserService(db).list_all(
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


@router.post("/users/batch", response_model=BatchCreateResult)
def batch_create_users(users: list[BatchUserItem], current_user: _Manager, db: DbSession):
    result = UserService(db).batch_create([u.model_dump() for u in users])
    log.info(
        f"批量导入: created={result['created']} skipped={result['skipped']}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )
    return result


@router.post("/users/bulk-assign-class", response_model=BulkAssignClassResult)
def bulk_assign_class(req: BulkAssignClassRequest, current_user: _Manager, db: DbSession):
    result = UserService(db).bulk_assign_class(req.user_ids, req.class_id)
    log.info(
        f"批量分配班级: assigned={result['assigned']} skipped={result['skipped']} class_id={req.class_id}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )
    return result


@router.get("/stats", response_model=AdminStats)
def get_stats(current_user: Annotated[User, Depends(require_permission("stats_view"))], db: DbSession):
    return UserService(db).get_stats()
