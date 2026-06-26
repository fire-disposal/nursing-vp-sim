from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models._base import TimestampMixin, _now_utc

if TYPE_CHECKING:
    from models.auth import User
    from models.case_practice import Case
    from models.tenant import School
    from models.training import TrainingRecord


class QuestionnaireTemplate(Base, TimestampMixin):
    __tablename__ = "questionnaire_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    school_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("schools.id", ondelete="SET NULL"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(120))
    type: Mapped[str] = mapped_column(String(20))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True)

    questions: Mapped[list[QuestionnaireQuestion]] = relationship(
        back_populates="template", order_by="QuestionnaireQuestion.sort_order", cascade="all, delete-orphan"
    )
    school: Mapped[School | None] = relationship()


class QuestionnaireQuestion(Base):
    __tablename__ = "questionnaire_questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    template_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("questionnaire_templates.id", ondelete="CASCADE"), index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    content: Mapped[str] = mapped_column(Text)
    question_type: Mapped[str] = mapped_column(String(20))
    required: Mapped[bool] = mapped_column(default=True)
    options: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    template: Mapped[QuestionnaireTemplate] = relationship(back_populates="questions")
    answers: Mapped[list[QuestionnaireAnswer]] = relationship(back_populates="question", cascade="all, delete-orphan")


class QuestionnaireResponse(Base):
    __tablename__ = "questionnaire_responses"
    __table_args__ = (
        Index("ix_qr_user_template", "user_id", "template_id"),
        Index("ix_qr_record_id", "record_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    template_id: Mapped[int] = mapped_column(Integer, ForeignKey("questionnaire_templates.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    case_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("cases.id", ondelete="SET NULL"), nullable=True)
    record_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("training_records.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(20), default="pending")
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)

    template: Mapped[QuestionnaireTemplate] = relationship()
    user: Mapped[User] = relationship()
    case: Mapped[Case | None] = relationship()
    record: Mapped[TrainingRecord | None] = relationship()
    answers: Mapped[list[QuestionnaireAnswer]] = relationship(
        back_populates="response", order_by="QuestionnaireAnswer.question_id", cascade="all, delete-orphan"
    )


class QuestionnaireAnswer(Base):
    __tablename__ = "questionnaire_answers"
    __table_args__ = (UniqueConstraint("response_id", "question_id", name="uq_qa_response_question"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    response_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("questionnaire_responses.id", ondelete="CASCADE"), index=True
    )
    question_id: Mapped[int] = mapped_column(Integer, ForeignKey("questionnaire_questions.id", ondelete="CASCADE"))
    answer_value: Mapped[str | None] = mapped_column(Text, nullable=True)

    response: Mapped[QuestionnaireResponse] = relationship(back_populates="answers")
    question: Mapped[QuestionnaireQuestion] = relationship(back_populates="answers")


class CaseQuestionnaire(Base):
    __tablename__ = "case_questionnaires"
    __table_args__ = (UniqueConstraint("case_id", "template_id", name="uq_cq_case_template"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int] = mapped_column(Integer, ForeignKey("cases.id", ondelete="CASCADE"))
    template_id: Mapped[int] = mapped_column(Integer, ForeignKey("questionnaire_templates.id", ondelete="CASCADE"))
    is_required: Mapped[bool] = mapped_column(default=True)
    trigger_event: Mapped[str] = mapped_column(String(30), default="before_training")

    case: Mapped[Case] = relationship()
    template: Mapped[QuestionnaireTemplate] = relationship()
