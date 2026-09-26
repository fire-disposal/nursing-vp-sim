"""学校组织模型 —— 单用户多班级成员模型（no 主班级 / no users.class_id）。

历史沿革：``grades``（年级）实体已退场，年级名称迁入 :attr:`Class.cohort_label`。
本轮是 expand 步骤：``grades`` 表与 ``classes.grade_id`` 只保留为回滚源，新代码不再
读写（见 ``migrations/versions/ddl/*_expand_class_memberships_and_assignment_audience.py``）。
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models._base import _now_utc

if TYPE_CHECKING:
    from models.auth import User

# 成员角色。学生名单 / 作业受众候选 / 班级排名 / 完成率一律取 student membership；
# teacher membership 是「教师在哪个班」的数据来源（本轮只落地数据，不做作用域强制）。
MEMBER_ROLE_STUDENT = "student"
MEMBER_ROLE_TEACHER = "teacher"
MEMBER_ROLES = (MEMBER_ROLE_STUDENT, MEMBER_ROLE_TEACHER)

# 遗留表 ``grades``：``Grade`` 实体已退场，但物理表与 ``classes.grade_id`` 仍作为回滚源
# 保留（见 ddl 迁移 *_expand_class_memberships_and_assignment_audience）。这里只声明
# Table 让 ``classes.grade_id`` 的外键可解析、元数据与库一致；不做 ORM 映射，
# 业务代码不得读写（盘点走 scripts/audit-class-membership-assignment-audience.py 的原始 SQL）。
legacy_grades_table = Table(
    "grades",
    Base.metadata,
    Column("id", Integer, primary_key=True),
    Column("name", String(40), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    UniqueConstraint("name", name="uq_grades_name"),
)


class Class(Base):
    """班级。归属由 ``cohort_label``（届/年级标签）+ ``name`` 唯一确定。"""

    __tablename__ = "classes"
    __table_args__ = (
        UniqueConstraint("cohort_label", "name", name="uq_classes_cohort_label_name"),
        # 遗留约束：随 grade_id 一起保留为回滚源（旧代码仍按 (grade_id, name) 判重）。
        UniqueConstraint("grade_id", "name", name="classes_grade_id_name_key"),
        Index("ix_classes_grade_id", "grade_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(60))
    cohort_label: Mapped[str] = mapped_column(String(40), default="", server_default=text("''"))
    # 遗留列（nullable）：本轮只保留不迁移，新代码不写入；downgrade 时用于还原旧结构。
    grade_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("grades.id", ondelete="CASCADE"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc)

    memberships: Mapped[list[ClassMembership]] = relationship(back_populates="class_", cascade="all, delete-orphan")


class ClassMembership(Base):
    """用户 × 班级 成员关系（表名沿用历史的 ``user_class``）。

    一个用户可以属于多个班级（各自一条记录），``member_role`` 说明在本班是学生还是教师。
    """

    __tablename__ = "user_class"
    __table_args__ = (
        CheckConstraint("member_role IN ('student', 'teacher')", name="ck_user_class_member_role"),
        UniqueConstraint("user_id", "class_id", name="uq_user_class_user_id_class_id"),
        Index("ix_user_class_class_id", "class_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    class_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("classes.id", ondelete="SET NULL"), nullable=True)
    member_role: Mapped[str] = mapped_column(String(20), default=MEMBER_ROLE_STUDENT, server_default=text("'student'"))
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc)

    user: Mapped[User] = relationship(back_populates="memberships")
    class_: Mapped[Class] = relationship(back_populates="memberships")
