from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


def _now_utc() -> datetime:
    return datetime.now(UTC)


class School(Base):
    __tablename__ = "schools"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)


class Role(Base):
    __tablename__ = "roles"
    __table_args__ = (UniqueConstraint("school_id", "name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(20))
    display_name: Mapped[str] = mapped_column(String(40))
    school_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("schools.id", ondelete="CASCADE"), nullable=True)
    is_system: Mapped[bool] = mapped_column(default=False)

    school: Mapped["School | None"] = relationship()


class RolePermission(Base):
    __tablename__ = "role_permissions"
    __table_args__ = (UniqueConstraint("role_id", "permission", name="ix_rp_role_perm"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role_id: Mapped[int] = mapped_column(Integer, ForeignKey("roles.id", ondelete="CASCADE"))
    permission: Mapped[str] = mapped_column(String(40))


class Grade(Base):
    __tablename__ = "grades"
    __table_args__ = (UniqueConstraint("school_id", "name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(40))
    academic_year: Mapped[str | None] = mapped_column(String(9), nullable=True)
    school_id: Mapped[int] = mapped_column(Integer, ForeignKey("schools.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)

    classes: Mapped[list["Class"]] = relationship(back_populates="grade", cascade="all, delete-orphan")
    school: Mapped["School"] = relationship()


class Class(Base):
    __tablename__ = "classes"
    __table_args__ = (
        UniqueConstraint("grade_id", "name"),
        Index("ix_classes_grade_id", "grade_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    grade_id: Mapped[int] = mapped_column(Integer, ForeignKey("grades.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(60))
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)

    grade: Mapped["Grade"] = relationship(back_populates="classes")
    user_classes: Mapped[list["UserClass"]] = relationship(back_populates="class_", cascade="all, delete-orphan")


class UserClass(Base):
    __tablename__ = "user_class"
    __table_args__ = (Index("ix_user_class_class_id", "class_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    class_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("classes.id", ondelete="SET NULL"), nullable=True)
    joined_at: Mapped[datetime] = mapped_column(default=_now_utc)

    user: Mapped["User"] = relationship(back_populates="user_classes")
    class_: Mapped["Class"] = relationship(back_populates="user_classes")


class User(Base):
    __tablename__ = "users"
    __table_args__ = (Index("ix_users_school_id", "school_id"), Index("ix_users_student_id", "student_id"))

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role_id: Mapped[int] = mapped_column(Integer, ForeignKey("roles.id", ondelete="RESTRICT"))
    school_id: Mapped[int] = mapped_column(Integer, ForeignKey("schools.id", ondelete="RESTRICT"))
    display_name: Mapped[str] = mapped_column(String(50))
    student_id: Mapped[str | None] = mapped_column(String(30), nullable=True)
    email: Mapped[str | None] = mapped_column(String(120), nullable=True)
    gender: Mapped[str | None] = mapped_column(String(4), nullable=True)
    avatar: Mapped[str | None] = mapped_column(String(255), nullable=True)
    wechat_openid: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True, index=True)
    is_active: Mapped[bool] = mapped_column(default=True, server_default=text("true"))
    token_version: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"))
    last_login_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)
    updated_at: Mapped[datetime] = mapped_column(default=_now_utc, onupdate=_now_utc)

    training_records: Mapped[list["TrainingRecord"]] = relationship(back_populates="user")
    user_classes: Mapped[list["UserClass"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    role: Mapped["Role"] = relationship()
    school: Mapped["School"] = relationship()

    def has_permission(self, permission: str) -> bool:
        cache = getattr(self, "_permissions_cache", None)
        if cache is None:
            return False
        return permission in cache

    def set_permissions_cache(self, permissions: set[str]) -> None:
        self._permissions_cache = permissions


class Case(Base):
    __tablename__ = "cases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    case_data: Mapped[dict] = mapped_column(JSONB)
    school_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("schools.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)
    updated_at: Mapped[datetime] = mapped_column(default=_now_utc, onupdate=_now_utc)

    school: Mapped["School | None"] = relationship()
    practices: Mapped[list["Practice"]] = relationship(back_populates="case")


class Practice(Base):
    __tablename__ = "practices"
    __table_args__ = (
        Index("ix_practices_case_id", "case_id"),
        Index("ix_practices_school_id", "school_id"),
        CheckConstraint(
            "mode IN ('training', 'assessment', 'free_play')",
            name="ck_practices_mode",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    case_id: Mapped[int] = mapped_column(Integer, ForeignKey("cases.id", ondelete="RESTRICT"))
    school_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("schools.id", ondelete="SET NULL"), nullable=True)
    mode: Mapped[str] = mapped_column(String(20), default="training")
    features: Mapped[dict] = mapped_column(JSONB, default=dict)
    behavior: Mapped[dict] = mapped_column(JSONB, default=dict)
    assessment: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)
    updated_at: Mapped[datetime] = mapped_column(default=_now_utc, onupdate=_now_utc)

    case: Mapped["Case"] = relationship(back_populates="practices")
    school: Mapped["School | None"] = relationship()
    assignments: Mapped[list["Assignment"]] = relationship(back_populates="practice")
    training_records: Mapped[list["TrainingRecord"]] = relationship(back_populates="practice")


class Assignment(Base):
    __tablename__ = "assignments"
    __table_args__ = (
        Index("ix_assignments_teacher", "teacher_id"),
        Index("ix_assignments_class", "class_id"),
        Index("ix_assignments_practice", "practice_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    practice_id: Mapped[int] = mapped_column(Integer, ForeignKey("practices.id", ondelete="RESTRICT"))
    class_id: Mapped[int] = mapped_column(Integer, ForeignKey("classes.id", ondelete="RESTRICT"))
    teacher_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="RESTRICT"))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_time: Mapped[datetime] = mapped_column()
    end_time: Mapped[datetime] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)
    updated_at: Mapped[datetime] = mapped_column(default=_now_utc, onupdate=_now_utc)

    practice: Mapped["Practice"] = relationship(back_populates="assignments")
    class_: Mapped["Class"] = relationship()
    teacher: Mapped["User"] = relationship(foreign_keys=[teacher_id])
    training_records: Mapped[list["TrainingRecord"]] = relationship(back_populates="assignment")


class TrainingRecord(Base):
    __tablename__ = "training_records"
    __table_args__ = (
        Index("ix_tr_user_status", "user_id", "status"),
        Index("ix_tr_status", "status"),
        Index("ix_tr_start_time", "start_time"),
        Index("ix_tr_case_id", "case_id"),
        Index("ix_tr_practice_id", "practice_id"),
        CheckConstraint(
            "status IN ('in_progress', 'completed', 'abandoned')",
            name="ck_training_records_status",
        ),
        CheckConstraint(
            "scoring_status IN ('pending', 'processing', 'completed', 'failed')",
            name="ck_training_records_scoring_status",
        ),
        CheckConstraint(
            "current_phase IN ('history_taking', 'physical_exam', 'ending')",
            name="ck_training_records_current_phase",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", name="fk_training_records_user_id"))
    case_id: Mapped[int] = mapped_column(Integer, ForeignKey("cases.id", name="fk_training_records_case_id"))
    practice_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("practices.id", name="fk_training_records_practice_id"), nullable=True
    )
    practice_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    runtime_state: Mapped[dict] = mapped_column(JSONB, server_default=text("'{}'::jsonb"), default=dict)
    status: Mapped[str] = mapped_column(String(20), default="in_progress")
    scoring_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    scoring_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    time_limit: Mapped[int] = mapped_column(Integer, default=20)
    rubric_frozen: Mapped[str | None] = mapped_column(String(80), nullable=True)
    current_phase: Mapped[str | None] = mapped_column(String(50), nullable=True)
    assignment_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("assignments.id", ondelete="SET NULL"), nullable=True
    )
    is_overdue: Mapped[bool] = mapped_column(default=False, server_default=text("false"))
    start_time: Mapped[datetime] = mapped_column(default=_now_utc)
    end_time: Mapped[datetime | None] = mapped_column(nullable=True)

    user: Mapped["User"] = relationship(back_populates="training_records")
    case: Mapped["Case"] = relationship()
    practice: Mapped["Practice | None"] = relationship(back_populates="training_records")
    assignment: Mapped["Assignment | None"] = relationship(back_populates="training_records")
    messages: Mapped[list["Message"]] = relationship(back_populates="record", order_by="Message.created_at")
    score: Mapped["Score | None"] = relationship(back_populates="record", uselist=False)


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        Index("ix_msg_record_created", "record_id", "created_at"),
        Index("ix_msg_role", "role"),
        CheckConstraint(
            "role IN ('student', 'patient', 'system')",
            name="ck_messages_role",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    record_id: Mapped[int] = mapped_column(Integer, ForeignKey("training_records.id", name="fk_messages_record_id"))
    role: Mapped[str] = mapped_column(String(10))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)

    record: Mapped["TrainingRecord"] = relationship(back_populates="messages")


class Score(Base):
    __tablename__ = "scores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    record_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("training_records.id", name="fk_scores_record_id"), unique=True
    )
    total_score: Mapped[float] = mapped_column(Float)
    detail_scores: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    strengths: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    weaknesses: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    missed_content: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    suggestions: Mapped[str | None] = mapped_column(Text, nullable=True)
    rubric_version: Mapped[str | None] = mapped_column(String(40), nullable=True)
    model_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    prompt_version: Mapped[int | None] = mapped_column(Integer, nullable=True, default=1)
    score_scale: Mapped[int | None] = mapped_column(Integer, nullable=True, default=100)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)

    record: Mapped["TrainingRecord"] = relationship(back_populates="score")
    reviews: Mapped[list["ScoreReview"]] = relationship(
        back_populates="score", order_by="ScoreReview.created_at", cascade="all, delete-orphan"
    )


class ScoreReview(Base):
    __tablename__ = "score_reviews"
    __table_args__ = (UniqueConstraint("score_id", name="uq_score_reviews_score_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    score_id: Mapped[int] = mapped_column(Integer, ForeignKey("scores.id", ondelete="CASCADE"))
    reviewed_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    detail_scores: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)

    score: Mapped["Score"] = relationship(back_populates="reviews")
    reviewer: Mapped["User | None"] = relationship()


class Note(Base):
    __tablename__ = "notes"
    __table_args__ = (Index("ix_notes_record_id", "record_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    record_id: Mapped[int] = mapped_column(Integer, ForeignKey("training_records.id"))
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)
    updated_at: Mapped[datetime] = mapped_column(default=_now_utc, onupdate=_now_utc)


class Rubric(Base):
    __tablename__ = "rubrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    version: Mapped[str] = mapped_column(String(40))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    total_max: Mapped[int] = mapped_column(Integer, default=100)
    raw_max: Mapped[int] = mapped_column(Integer, default=57)
    raw_scale: Mapped[int] = mapped_column(Integer, default=3)
    dimensions: Mapped[list] = mapped_column(JSONB)
    is_active: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)
    updated_at: Mapped[datetime] = mapped_column(default=_now_utc, onupdate=_now_utc)


class LLMCallLog(Base):
    __tablename__ = "llm_call_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    record_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("training_records.id"), nullable=True, index=True)
    case_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("cases.id"), nullable=True, index=True)
    purpose: Mapped[str] = mapped_column(String(40), index=True)
    provider_name: Mapped[str] = mapped_column(String(40), default="deepseek")
    api_key_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    config_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("llm_configs.id"), nullable=True, index=True)
    model: Mapped[str] = mapped_column(String(80))
    temperature: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    token_estimated: Mapped[int] = mapped_column(Integer, default=1)
    estimated_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    cost_currency: Mapped[str | None] = mapped_column(String(10), nullable=True, default="CNY")
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), index=True)
    error_type: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    request_chars: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_chars: Mapped[int | None] = mapped_column(Integer, nullable=True)
    request_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    response_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(index=True, default=_now_utc)

    config: Mapped["LLMConfig"] = relationship()


class QASession(Base):
    __tablename__ = "qa_sessions"
    __table_args__ = (Index("ix_qa_sessions_user_updated", "user_id", "updated_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)
    updated_at: Mapped[datetime] = mapped_column(default=_now_utc, onupdate=_now_utc)

    user: Mapped["User"] = relationship()
    records: Mapped[list["QARecord"]] = relationship(back_populates="session", order_by="QARecord.created_at")


class QARecord(Base):
    __tablename__ = "qa_records"
    __table_args__ = (Index("ix_qa_session_created", "session_id", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(Integer, ForeignKey("qa_sessions.id"), index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(index=True, default=_now_utc)

    user: Mapped["User"] = relationship()
    session: Mapped["QASession"] = relationship(back_populates="records")


class ApiSecret(Base):
    __tablename__ = "api_secrets"
    __table_args__ = (UniqueConstraint("encrypted_key", "key_suffix", name="uq_api_secret_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    label: Mapped[str] = mapped_column(String(80))
    encrypted_key: Mapped[str] = mapped_column(Text)
    key_suffix: Mapped[str] = mapped_column(String(8))
    base_url: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(20), default="active")
    degraded_reason: Mapped[str | None] = mapped_column(String(40), nullable=True)
    degraded_until: Mapped[datetime | None] = mapped_column(nullable=True)
    price_input_per_1m: Mapped[float] = mapped_column(Numeric(10, 6), default=0)
    price_output_per_1m: Mapped[float] = mapped_column(Numeric(10, 6), default=0)
    monthly_cost_limit: Mapped[float | None] = mapped_column(Numeric(12, 6), nullable=True)
    call_count_today: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens_today: Mapped[int] = mapped_column(BigInteger, default=0)
    total_cost_today: Mapped[float] = mapped_column(Numeric(12, 6), default=0)
    monthly_cost_used: Mapped[float] = mapped_column(Numeric(12, 6), default=0)
    stats_date: Mapped[datetime | None] = mapped_column(nullable=True)
    stats_month: Mapped[str | None] = mapped_column(String(7), nullable=True)
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0)
    last_used_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)
    updated_at: Mapped[datetime] = mapped_column(default=_now_utc, onupdate=_now_utc)

    configs: Mapped[list["LLMConfig"]] = relationship(back_populates="secret", cascade="all, delete-orphan")


class LLMConfig(Base):
    __tablename__ = "llm_configs"
    __table_args__ = (UniqueConstraint("secret_id", "purpose", name="uq_llmconfig_profile_purpose"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    secret_id: Mapped[int] = mapped_column(Integer, ForeignKey("api_secrets.id"))
    label: Mapped[str] = mapped_column(String(80), default="")
    model: Mapped[str] = mapped_column(String(80))
    purpose: Mapped[str] = mapped_column(String(40))
    priority: Mapped[int] = mapped_column(Integer, default=10)
    weight: Mapped[int] = mapped_column(Integer, default=10)
    status: Mapped[str] = mapped_column(String(20), default="active")
    price_input_per_1m: Mapped[float] = mapped_column(Numeric(10, 6), default=0)
    price_output_per_1m: Mapped[float] = mapped_column(Numeric(10, 6), default=0)
    monthly_cost_limit: Mapped[float | None] = mapped_column(Numeric(12, 6), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)
    updated_at: Mapped[datetime] = mapped_column(default=_now_utc, onupdate=_now_utc)

    secret: Mapped["ApiSecret"] = relationship(back_populates="configs")


# DEPRECATED — kept for migration compatibility, will be dropped in a future cleanup
class ApiProvider(Base):
    __tablename__ = "api_providers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(40), unique=True)
    display_name: Mapped[str] = mapped_column(String(80))
    base_url: Mapped[str] = mapped_column(String(200))
    api_type: Mapped[str] = mapped_column(String(20), default="openai_compatible")
    default_model: Mapped[str] = mapped_column(String(80))
    is_enabled: Mapped[bool] = mapped_column(default=True)
    priority: Mapped[int] = mapped_column(Integer, default=100)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)
    updated_at: Mapped[datetime] = mapped_column(default=_now_utc, onupdate=_now_utc)


class Feedback(Base):
    __tablename__ = "feedbacks"
    __table_args__ = (
        Index("ix_feedback_user_id", "user_id"),
        Index("ix_feedback_tag", "tag"),
        Index("ix_feedback_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"))
    rating: Mapped[int] = mapped_column(Integer)
    tag: Mapped[str] = mapped_column(String(20))
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)

    user: Mapped["User"] = relationship()


class PromptTemplate(Base):
    __tablename__ = "prompt_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    purpose: Mapped[str] = mapped_column(String(40), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    system_prompt: Mapped[str] = mapped_column(Text)
    user_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    template_engine: Mapped[str] = mapped_column(String(20), default="format")
    variables: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    is_active: Mapped[bool] = mapped_column(default=False)
    created_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)
    updated_at: Mapped[datetime] = mapped_column(default=_now_utc, onupdate=_now_utc)


class QuestionnaireTemplate(Base):
    __tablename__ = "questionnaire_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    school_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("schools.id", ondelete="SET NULL"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(120))
    type: Mapped[str] = mapped_column(String(20))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)
    updated_at: Mapped[datetime] = mapped_column(default=_now_utc, onupdate=_now_utc)

    questions: Mapped[list["QuestionnaireQuestion"]] = relationship(
        back_populates="template", order_by="QuestionnaireQuestion.sort_order", cascade="all, delete-orphan"
    )
    school: Mapped["School | None"] = relationship()


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

    template: Mapped["QuestionnaireTemplate"] = relationship(back_populates="questions")
    answers: Mapped[list["QuestionnaireAnswer"]] = relationship(back_populates="question", cascade="all, delete-orphan")


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

    template: Mapped["QuestionnaireTemplate"] = relationship()
    user: Mapped["User"] = relationship()
    case: Mapped["Case | None"] = relationship()
    record: Mapped["TrainingRecord | None"] = relationship()
    answers: Mapped[list["QuestionnaireAnswer"]] = relationship(
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

    response: Mapped["QuestionnaireResponse"] = relationship(back_populates="answers")
    question: Mapped["QuestionnaireQuestion"] = relationship(back_populates="answers")


class CaseQuestionnaire(Base):
    __tablename__ = "case_questionnaires"
    __table_args__ = (UniqueConstraint("case_id", "template_id", name="uq_cq_case_template"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int] = mapped_column(Integer, ForeignKey("cases.id", ondelete="CASCADE"))
    template_id: Mapped[int] = mapped_column(Integer, ForeignKey("questionnaire_templates.id", ondelete="CASCADE"))
    is_required: Mapped[bool] = mapped_column(default=True)
    trigger_event: Mapped[str] = mapped_column(String(30), default="before_training")

    case: Mapped["Case"] = relationship()
    template: Mapped["QuestionnaireTemplate"] = relationship()


class NursingRecord(Base):
    __tablename__ = "nursing_records"
    __table_args__ = (Index("ix_nr_record_id", "record_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    record_id: Mapped[int] = mapped_column(Integer, ForeignKey("training_records.id", ondelete="CASCADE"), unique=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    sheet_data: Mapped[dict] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)
    updated_at: Mapped[datetime] = mapped_column(default=_now_utc, onupdate=_now_utc)

    record: Mapped["TrainingRecord"] = relationship()
    user: Mapped["User"] = relationship()


class SystemNotification(Base):
    __tablename__ = "system_notifications"
    __table_args__ = (
        CheckConstraint(
            "level IN ('info', 'warning', 'success')",
            name="ck_sn_level",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text)
    level: Mapped[str] = mapped_column(String(20), default="info")
    is_active: Mapped[bool] = mapped_column(default=True)
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)
    updated_at: Mapped[datetime] = mapped_column(default=_now_utc, onupdate=_now_utc)

    creator: Mapped["User | None"] = relationship()


class ScoringProgress(Base):
    __tablename__ = "scoring_progress"
    __table_args__ = (UniqueConstraint("record_id", name="uq_sp_record"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    record_id: Mapped[int] = mapped_column(Integer, ForeignKey("training_records.id", ondelete="CASCADE"), unique=True)
    stage: Mapped[str] = mapped_column(String(20), default="pending")
    percent: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)
    updated_at: Mapped[datetime] = mapped_column(default=_now_utc, onupdate=_now_utc)


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_read", "user_id", "is_read"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    record_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    type: Mapped[str] = mapped_column(String(30))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_read: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)

    user: Mapped["User"] = relationship()
