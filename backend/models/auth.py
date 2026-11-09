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


class UserSchoolPersona(Base):
    """用户在某所院校被授予的视角（家院校与外校都用本表）。

    一个账号可以属于多所院校：``users.school_id`` 是家/默认院校，本表按
    ``(user_id, school_id, persona)`` 记授予（家院校同样落本表，无第二真相源）。
    安全判定只认 ``(user_id, school_id, persona)``；班级只是校内业务分组。
    """

    __tablename__ = "user_school_personas"
    __table_args__ = (Index("ix_user_school_personas_persona", "persona"),)

    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    school_id: Mapped[int] = mapped_column(Integer, ForeignKey("schools.id", ondelete="CASCADE"), primary_key=True)
    persona: Mapped[str] = mapped_column(String(20), primary_key=True)


class UserSchoolProfile(Base):
    """学生在某校的学号（多校学生按校独立；非学生不落行）。

    ``users.student_id`` 仅保留为家院校/兼容展示，唯一性以本表 ``(school_id, student_id)`` 为准。
    """

    __tablename__ = "user_school_profiles"
    __table_args__ = (UniqueConstraint("school_id", "student_id", name="uq_user_school_profiles_school_student"),)

    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    school_id: Mapped[int] = mapped_column(Integer, ForeignKey("schools.id", ondelete="CASCADE"), primary_key=True)
    student_id: Mapped[str | None] = mapped_column(String(30), nullable=True)


class User(Base, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = (Index("ix_users_student_id", "student_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
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
    # 平台账号标记（原 super_admin 的显式化）：平台 = 全部院校 × 全部视角。
    # 只能由数据迁移/运维置位，API 不接受写入；角色名不再承担这一语义。
    is_platform: Mapped[bool] = mapped_column(default=False, server_default=text("false"), nullable=False)
    token_version: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 账号级登录失败锁定（方案 A6）：连续密码错误计数 + 锁定截止时刻（NULL = 未锁定）
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    training_records: Mapped[list[TrainingRecord]] = relationship(back_populates="user")
    memberships: Mapped[list[ClassMembership]] = relationship(back_populates="user", cascade="all, delete-orphan")

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
    _active_school_id: int | None
    _access_context: object | None

    def set_permissions_cache(self, permissions: set[str]) -> None:
        self._permissions_cache = permissions

    def set_active_persona(self, persona: str | None) -> None:
        self._active_persona = persona

    @property
    def active_persona(self) -> str | None:
        """当前请求生效的视角（由 `core.security.get_current_user` 写入）。"""
        return getattr(self, "_active_persona", None)

    def set_active_school(self, school_id: int | None) -> None:
        self._active_school_id = school_id

    def set_access_context(self, context: object | None) -> None:
        self._access_context = context

    @property
    def access_context(self) -> object | None:
        return getattr(self, "_access_context", None)

    @property
    def active_school_id(self) -> int | None:
        """当前请求生效的院校（多校账号按请求头选择；平台可为 None=全局）。"""
        return getattr(self, "_active_school_id", None)
