from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Index, Integer, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models._base import TimestampMixin

if TYPE_CHECKING:
    from models.school import UserClass
    from models.training import TrainingRecord


class Role(Base):
    __tablename__ = "roles"
    __table_args__ = (UniqueConstraint("name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(20))
    display_name: Mapped[str] = mapped_column(String(40))
    is_system: Mapped[bool] = mapped_column(default=False)


class RolePermission(Base):
    __tablename__ = "role_permissions"
    __table_args__ = (UniqueConstraint("role_id", "permission", name="ix_rp_role_perm"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role_id: Mapped[int] = mapped_column(Integer, ForeignKey("roles.id", ondelete="CASCADE"))
    permission: Mapped[str] = mapped_column(String(40))


class User(Base, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = (Index("ix_users_student_id", "student_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role_id: Mapped[int] = mapped_column(Integer, ForeignKey("roles.id", ondelete="RESTRICT"))
    display_name: Mapped[str] = mapped_column(String(50))
    student_id: Mapped[str | None] = mapped_column(String(30), nullable=True)
    email: Mapped[str | None] = mapped_column(String(120), nullable=True)
    gender: Mapped[str | None] = mapped_column(String(4), nullable=True)
    avatar: Mapped[str | None] = mapped_column(String(255), nullable=True)
    wechat_openid: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True, index=True)
    is_active: Mapped[bool] = mapped_column(default=True, server_default=text("true"))
    token_version: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"))
    last_login_at: Mapped[datetime | None] = mapped_column(nullable=True)

    training_records: Mapped[list[TrainingRecord]] = relationship(back_populates="user")
    user_classes: Mapped[list[UserClass]] = relationship(back_populates="user", cascade="all, delete-orphan")
    role: Mapped[Role] = relationship()

    def has_permission(self, permission: str) -> bool:
        cache = getattr(self, "_permissions_cache", None)
        if cache is None:
            return False
        return permission in cache

    def set_permissions_cache(self, permissions: set[str]) -> None:
        self._permissions_cache = permissions
