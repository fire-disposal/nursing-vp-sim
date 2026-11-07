from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models._base import TimestampMixin

if TYPE_CHECKING:
    from models.school import ClassMembership
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


class UserPersona(Base):
    """用户被授予的视角（多对多，复合主键）。

    视角预设由代码拥有（`core/personas.py`），本表只记"谁能以哪些视角操作"。
    超级管理员**派生**拥有全部视角，因此没有行；迁移前的老用户也没有行 →
    走 legacy `role_permissions`（见 `core.security.resolve_view_persona`）。
    """

    __tablename__ = "user_personas"
    __table_args__ = (Index("ix_user_personas_persona", "persona"),)

    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    persona: Mapped[str] = mapped_column(String(20), primary_key=True)


class User(Base, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = (Index("ix_users_student_id", "student_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role_id: Mapped[int] = mapped_column(Integer, ForeignKey("roles.id", ondelete="RESTRICT"))
    # 院校租户。NULL = 平台角色（跨院校可见，例如 super_admin）；院校管理员/教师/学生必须非空。
    school_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("schools.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    display_name: Mapped[str] = mapped_column(String(50))
    student_id: Mapped[str | None] = mapped_column(String(30), nullable=True)
    email: Mapped[str | None] = mapped_column(String(120), nullable=True)
    gender: Mapped[str | None] = mapped_column(String(4), nullable=True)
    avatar: Mapped[str | None] = mapped_column(String(255), nullable=True)
    wechat_openid: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True, index=True)
    is_active: Mapped[bool] = mapped_column(default=True, server_default=text("true"))
    token_version: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 账号级登录失败锁定（方案 A6）：连续密码错误计数 + 锁定截止时刻（NULL = 未锁定）
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    training_records: Mapped[list[TrainingRecord]] = relationship(back_populates="user")
    memberships: Mapped[list[ClassMembership]] = relationship(back_populates="user", cascade="all, delete-orphan")
    role: Mapped[Role] = relationship()

    def has_permission(self, permission: str) -> bool:
        cache = getattr(self, "_permissions_cache", None)
        if cache is None:
            return False
        return permission in cache

    # 请求级快照（非持久化、非映射列）：生效权限集合与当前视角，由
    # core.security.get_current_user 每次请求解析后写入实例，随会话对象消亡。
    # 普通注解 + `__allow_unmapped__`：既不会被 ORM 当成待映射列，也允许实例赋值。
    __allow_unmapped__ = True
    _permissions_cache: set[str] | None
    _active_persona: str | None

    def set_permissions_cache(self, permissions: set[str]) -> None:
        self._permissions_cache = permissions

    def set_active_persona(self, persona: str | None) -> None:
        self._active_persona = persona

    @property
    def active_persona(self) -> str | None:
        """当前请求生效的视角（由 `core.security.get_current_user` 写入）。"""
        return getattr(self, "_active_persona", None)
