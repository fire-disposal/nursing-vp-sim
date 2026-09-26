from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models._base import TimestampMixin, _now_utc

if TYPE_CHECKING:
    from models.auth import User

# ── 病例产品生命周期（docs/15 §六）────────────────────────────────────────
# status 管「能不能被新训练/作业使用」，CaseRevision 管「内容不可变」。
# draft     —— 未发布：不能被作业/训练使用（发布门禁见 modules/cases/service.py）
# published —— 已发布：学员按 current_revision 训练
# archived  —— 已归档：只阻止新使用，不删除历史 revision 与既有训练
CASE_STATUS_DRAFT = "draft"
CASE_STATUS_PUBLISHED = "published"
CASE_STATUS_ARCHIVED = "archived"
CASE_STATUSES = (CASE_STATUS_DRAFT, CASE_STATUS_PUBLISHED, CASE_STATUS_ARCHIVED)


class Case(Base, TimestampMixin):
    __tablename__ = "cases"
    __table_args__ = (CheckConstraint("status IN ('draft', 'published', 'archived')", name="ck_cases_status"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    difficulty: Mapped[int] = mapped_column(Integer, default=1)
    time_limit_minutes: Mapped[int] = mapped_column(Integer, default=20)
    #: 学生目录可见性开关（教师侧「向学生开放」）。与 status 正交：
    #: 只有 published + is_open 才出现在学生目录；status 决定能不能被新训练使用。
    is_open: Mapped[bool] = mapped_column(default=False)
    status: Mapped[str] = mapped_column(String(20), default=CASE_STATUS_DRAFT, server_default=text("'draft'"))
    #: 工作副本（教师编辑对象）。元数据（name/difficulty/time_limit）只在本表的列，
    #: 落库前从 case_data 剥离（docs/15 §六、§十五.3）。
    case_data: Mapped[dict] = mapped_column(JSONB, default=dict)
    #: 学员实际训练引用的不可变版本。与 case_revisions.case_id 构成表间环，
    #: 因此用 use_alter（建表后再补 FK）。
    current_revision_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey(
            "case_revisions.id",
            ondelete="SET NULL",
            name="fk_cases_current_revision_id",
            use_alter=True,
        ),
        nullable=True,
    )

    current_revision: Mapped[CaseRevision | None] = relationship(foreign_keys=[current_revision_id], post_update=True)
    revisions: Mapped[list[CaseRevision]] = relationship(
        back_populates="case",
        foreign_keys="CaseRevision.case_id",
        order_by="CaseRevision.revision_no",
        cascade="all, delete-orphan",
    )

    @property
    def current_revision_no(self) -> int | None:
        """当前版本的序号（未发布/无版本时为 None）。"""
        return self.current_revision.revision_no if self.current_revision else None


class CaseRevision(Base):
    """病例内容的不可变版本（docs/15 §六）。

    内容为什么是单个 ``content`` JSONB 而不是 clinical_data / 查体锚点 /
    activity_config 多列：病例载荷本来就是一份 JSON，查体锚点住在
    ``activities.physical_exam.config``，按 Activity 切成多列等于把同一份
    数据复制成两份真相源，且每加一个 Activity 都要改表。revision 只负责**内容**；
    评分规则随记录冻结在 ``training_records.rubric_snapshot``（modules/training/scoring），
    不在这里再做一份。

    **不可变**：没有任何更新路径。教师编辑已发布病例 = 追加新 revision
    （revision_no + 1）并移动 ``Case.current_revision_id``，旧训练永远按旧版复盘。
    """

    __tablename__ = "case_revisions"
    __table_args__ = (
        UniqueConstraint("case_id", "revision_no", name="uq_case_revisions_case_revision_no"),
        Index("ix_case_revisions_case_id", "case_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("cases.id", ondelete="CASCADE", name="fk_case_revisions_case_id")
    )
    revision_no: Mapped[int] = mapped_column(Integer)
    #: 冻结的病例载荷（与 Case.case_data 落库形状一致：已剥离元数据键）
    content: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL", name="fk_case_revisions_created_by"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    case: Mapped[Case] = relationship(back_populates="revisions", foreign_keys=[case_id])
    creator: Mapped[User | None] = relationship(foreign_keys=[created_by])
