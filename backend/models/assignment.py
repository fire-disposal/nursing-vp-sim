"""作业（练习发布）模型 —— 受众在发布时固化到 ``assignment_recipients``。

历史沿革：受众曾是 ``assignments.student_ids``（JSONB，NULL=全班动态）。受众快照
（:class:`AssignmentRecipient`）接管后该列只剩陈旧副本，已由 ddl 迁移 ``f5a6b7c8d9e0``
从库中删除（contract 步骤，单向）；受众的唯一 owner 是受众快照。
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models._base import TimestampMixin

if TYPE_CHECKING:
    from models.auth import User
    from models.case import Case
    from models.school import Class
    from models.training import TrainingRecord

# 受众模式：class = 发布时全班学生成员快照；selected = 发布时显式指定名单。
AUDIENCE_CLASS = "class"
AUDIENCE_SELECTED = "selected"
AUDIENCE_MODES = (AUDIENCE_CLASS, AUDIENCE_SELECTED)


class Assignment(Base, TimestampMixin):
    __tablename__ = "assignments"
    __table_args__ = (
        CheckConstraint("audience_mode IN ('class', 'selected')", name="ck_assignments_audience_mode"),
        Index("ix_assignments_teacher", "teacher_id"),
        Index("ix_assignments_class", "class_id"),
        Index("ix_assignments_case", "case_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    case_id: Mapped[int] = mapped_column(Integer, ForeignKey("cases.id", ondelete="RESTRICT"))
    # 发布时钉住的病例版本（docs/15 §六），**非空**：作业期间病例被编辑出新 revision，
    # 本作业的学员仍按发布时的版本训练与复盘。发布动作（AssignmentService.create）只接受
    # published 病例并写入其 current_revision_id；没有版本的作业行不存在（旧行的回填见
    # 数据迁移 e6b2c3d4e5f6，NOT NULL 落地见 ddl 迁移 f5a6b7c8d9e0）。
    case_revision_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("case_revisions.id", ondelete="RESTRICT", name="fk_assignments_case_revision_id"),
    )
    # 发布范围（哪个班）
    class_id: Mapped[int] = mapped_column(Integer, ForeignKey("classes.id", ondelete="RESTRICT"))
    teacher_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="RESTRICT"))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    features: Mapped[dict] = mapped_column(JSONB, default=dict)
    behavior: Mapped[dict] = mapped_column(JSONB, default=dict)
    audience_mode: Mapped[str] = mapped_column(String(20), default=AUDIENCE_CLASS, server_default=text("'class'"))
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    is_closed: Mapped[bool] = mapped_column(default=False, server_default=text("false"))
    # NULL 或 0 = 不限制尝试次数（门控见 modules/assignments/progress.py）
    max_attempts: Mapped[int | None] = mapped_column(Integer, nullable=True, default=1)

    case: Mapped[Case] = relationship()
    class_: Mapped[Class] = relationship()
    teacher: Mapped[User] = relationship(foreign_keys=[teacher_id])
    training_records: Mapped[list[TrainingRecord]] = relationship(back_populates="assignment")
    recipients: Mapped[list[AssignmentRecipient]] = relationship(
        back_populates="assignment", cascade="all, delete-orphan"
    )


class AssignmentRecipient(Base):
    """作业受众快照：发布即固化，之后班级成员变动不改动已发布作业的受众与分母。"""

    __tablename__ = "assignment_recipients"
    __table_args__ = (Index("ix_assignment_recipients_user_id", "user_id"),)

    assignment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("assignments.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)

    assignment: Mapped[Assignment] = relationship(back_populates="recipients")
