"""User repository."""

from sqlalchemy.orm import Session

from models import User


class UserRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, user_id: int) -> User | None:
        return self.db.query(User).filter(User.id == user_id).first()

    def get_by_username(self, username: str) -> User | None:
        return self.db.query(User).filter(User.username == username).first()

    def list_by_school(self, school_id: int, offset: int = 0, limit: int = 50):
        return self.db.query(User).filter(User.school_id == school_id).offset(offset).limit(limit).all()

    def count_by_school(self, school_id: int) -> int:
        return self.db.query(User).filter(User.school_id == school_id).count()

    def create(self, **kwargs) -> User:
        user = User(**kwargs)
        self.db.add(user)
        self.db.flush()
        return user

    def update(self, user: User, **kwargs) -> User:
        for k, v in kwargs.items():
            setattr(user, k, v)
        self.db.flush()
        return user

    def delete(self, user: User) -> None:
        self.db.delete(user)
        self.db.flush()
