from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from core.config import BATCH_USER_LIMIT
from core.exceptions import NotFoundError, ValidationError
from core.security import hash_password
from core.unit_of_work import unit_of_work
from models import Class, Role, Score, TrainingRecord, User, UserClass
from repositories.user import UserRepository
from schemas import UserUpdateRequest

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
    def batch_create(self, users_data: list[dict]) -> dict:
        if len(users_data) > BATCH_USER_LIMIT:
            raise ValidationError(f"单次最多导入 {BATCH_USER_LIMIT} 个用户，当前 {len(users_data)} 个")

        class_ids = {u.get("class_id") for u in users_data if u.get("class_id")}
        valid_class_ids = (
            {c.id for c in self.db.query(Class).filter(Class.id.in_(class_ids)).all()} if class_ids else set()
        )

        created = 0
        skipped = 0
        errors = []

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
            if role_name not in ("student", "teacher"):
                errors.append(f"第{i}行跳过 {username}: 仅支持创建 student/teacher 角色")
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
        self.db.commit()
        return {"created": created, "skipped": skipped, "errors": errors}

    def get_stats(self) -> dict:
        student_role = self.db.query(Role).filter(Role.name == "student").first()
        total_students = 0
        if student_role:
            total_students = self.db.query(User).filter(User.role_id == student_role.id).count()

        from sqlalchemy import func as sa_func

        base = self.db.query(TrainingRecord).join(User)
        total_records = base.count()
        completed_records = base.filter(TrainingRecord.status == "completed").count()
        avg_score = (
            self.db.query(sa_func.avg(Score.total_score))
            .join(TrainingRecord, Score.record_id == TrainingRecord.id)
            .join(User, TrainingRecord.user_id == User.id)
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
            )
            .scalar()
        )
        today_start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        today_records = (
            self.db.query(sa_func.count(TrainingRecord.id))
            .join(User, TrainingRecord.user_id == User.id)
            .filter(TrainingRecord.start_time >= today_start)
            .scalar()
            or 0
        )

        return {
            "total_students": total_students,
            "total_records": total_records,
            "completed_records": completed_records,
            "average_score": round(float(avg_score), 1) if avg_score else None,
            "avg_duration_min": round(float(avg_duration), 1) if avg_duration else None,
            "today_records": today_records,
        }

    def __init__(self, db: Session):
        self.db = db
        self.repo = UserRepository(db)

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

    def list(
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
            role_obj = self.repo.get_role_by_name(role)
            role_id = role_obj.id if role_obj else -1
        total, users = self.repo.list_paginated(
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
        user = self.repo.get_with_relations(user_id)
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
                role_obj = self.repo.get_role_by_name(req.role)
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
            # class_id: pass 0 to remove user from their current class (sentinel value)
            if req.class_id is not None:
                if req.class_id != 0:
                    cls = self.repo.get_class(req.class_id)
                    if not cls:
                        raise ValidationError("班级不存在")
                uc = self.repo.get_user_class(user_id)
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
        user = self.repo.get_by_id(user_id)
        if not user:
            raise NotFoundError("用户不存在")
        record_count = self.repo.record_count(user_id)
        if record_count > 0:
            raise ValidationError(f"该用户有 {record_count} 条训练记录，无法删除。请先删除相关训练记录。")
        target_name = user.username
        with unit_of_work(self.db):
            self.repo.delete(user)
        return target_name

    def get_detail(self, user_id: int) -> StudentDetailView:
        user = self.repo.get_with_role(user_id)
        if not user:
            raise NotFoundError("用户不存在")
        since = datetime.now(UTC) - timedelta(days=_DETAIL_DAYS)

        stats = self.repo.training_summary(user_id)
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
            for r in self.repo.daily_stats(user_id, since)
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
            )
            for r in self.repo.recent_records(user_id, _DETAIL_RECENT_LIMIT)
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
