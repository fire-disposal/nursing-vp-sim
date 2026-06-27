from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from core.exceptions import NotFoundError, ValidationError
from core.security import hash_password
from core.unit_of_work import unit_of_work
from models import User, UserClass
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

    def update(self, user_id: int, req: UserUpdateRequest) -> UserBriefView:
        user = self.repo.get_with_relations(user_id)
        if not user:
            raise NotFoundError("用户不存在")
        with unit_of_work(self.db):
            if req.display_name is not None:
                user.display_name = req.display_name
            if req.student_id is not None:
                user.student_id = req.student_id or None
            if req.role is not None:
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
