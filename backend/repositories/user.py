"""User repository."""

from datetime import datetime

from sqlalchemy import func, or_
from sqlalchemy.orm import joinedload

from models import Class, Role, Score, TrainingRecord, User, UserClass
from repositories.base import Repository


class UserRepository(Repository[User]):
    model = User

    def get_by_id(self, user_id: int) -> User | None:
        return self.get(user_id)

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
        self.add(user)
        return user

    def update(self, user: User, **kwargs) -> User:
        for k, v in kwargs.items():
            setattr(user, k, v)
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
        return self.db.query(func.count(TrainingRecord.id)).filter(TrainingRecord.user_id == user_id).scalar() or 0

    def training_summary(self, user_id: int):
        return (
            self.db.query(
                func.count(TrainingRecord.id).label("total_sessions"),
                func.coalesce(
                    func.sum(func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60),
                    0,
                ).label("total_minutes"),
                func.coalesce(func.avg(Score.total_score), 0).label("avg_score"),
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
                func.date(TrainingRecord.start_time).label("d"),
                func.count().label("sessions"),
                func.sum(func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60).label(
                    "minutes"
                ),
                func.avg(Score.total_score).label("avg_score"),
            )
            .outerjoin(Score, Score.record_id == TrainingRecord.id)
            .filter(
                TrainingRecord.user_id == user_id,
                TrainingRecord.status == "completed",
                TrainingRecord.start_time >= since,
            )
            .group_by(func.date(TrainingRecord.start_time))
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
