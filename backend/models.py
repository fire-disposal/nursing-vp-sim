from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Text, Float, Boolean, DateTime, Date,
    BigInteger, Numeric, ForeignKey, Index, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from database import Base


class Role(Base):
    __tablename__ = "roles"

    name = Column(String(20), primary_key=True)
    display_name = Column(String(40), nullable=False)
    is_system = Column(Boolean, nullable=False, default=False)


class RolePermission(Base):
    __tablename__ = "role_permissions"
    __table_args__ = (
        UniqueConstraint("role_name", "permission", name="ix_rp_role_perm"),
    )

    id = Column(Integer, primary_key=True)
    role_name = Column(String(20), ForeignKey("roles.name", ondelete="CASCADE"), nullable=False)
    permission = Column(String(40), nullable=False)


class Grade(Base):
    __tablename__ = "grades"

    id = Column(Integer, primary_key=True)
    name = Column(String(40), unique=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    classes = relationship("Class", back_populates="grade", cascade="all, delete-orphan")


class Class(Base):
    __tablename__ = "classes"
    __table_args__ = (
        UniqueConstraint("grade_id", "name"),
        Index("ix_classes_grade_id", "grade_id"),
    )

    id = Column(Integer, primary_key=True)
    grade_id = Column(Integer, ForeignKey("grades.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(60), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    grade = relationship("Grade", back_populates="classes")
    user_classes = relationship("UserClass", back_populates="class_", cascade="all, delete-orphan")


class UserClass(Base):
    __tablename__ = "user_class"
    __table_args__ = (
        Index("ix_user_class_class_id", "class_id"),
    )

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    class_id = Column(Integer, ForeignKey("classes.id", ondelete="SET NULL"), nullable=True)
    joined_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="user_class")
    class_ = relationship("Class", back_populates="user_classes")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), ForeignKey("roles.name", ondelete="RESTRICT"), nullable=False, default="student")
    display_name = Column(String(50), nullable=False)
    student_id = Column(String(30), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    training_records = relationship("TrainingRecord", back_populates="user")
    user_class = relationship("UserClass", back_populates="user", uselist=False, cascade="all, delete-orphan")

    def has_permission(self, permission: str) -> bool:
        cache = getattr(self, "_permissions_cache", None)
        if cache is None:
            return False
        return permission in cache

    def set_permissions_cache(self, permissions: set[str]) -> None:
        self._permissions_cache = permissions


class Case(Base):
    __tablename__ = "cases"

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    case_data = Column(JSONB, nullable=False)  # 完整病例数据
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class TrainingRecord(Base):
    __tablename__ = "training_records"
    __table_args__ = (
        Index("ix_tr_user_status", "user_id", "status"),
        Index("ix_tr_status", "status"),
        Index("ix_tr_start_time", "start_time"),
        Index("ix_tr_case_id", "case_id"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    case_id = Column(Integer, ForeignKey("cases.id"), nullable=False)
    status = Column(String(20), nullable=False, default="in_progress")  # in_progress / completed
    scoring_status = Column(String(20), nullable=True)  # null / pending / processing / completed / failed
    scoring_error = Column(Text, nullable=True)  # 评分失败时的错误信息
    start_time = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    end_time = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", back_populates="training_records")
    case = relationship("Case")
    messages = relationship("Message", back_populates="record", order_by="Message.created_at")
    score = relationship("Score", back_populates="record", uselist=False)


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        Index("ix_msg_record_created", "record_id", "created_at"),
    )

    id = Column(Integer, primary_key=True)
    record_id = Column(Integer, ForeignKey("training_records.id"), nullable=False)
    role = Column(String(10), nullable=False)  # student / patient
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    record = relationship("TrainingRecord", back_populates="messages")


class Score(Base):
    __tablename__ = "scores"

    id = Column(Integer, primary_key=True)
    record_id = Column(Integer, ForeignKey("training_records.id"), unique=True, nullable=False)
    total_score = Column(Float, nullable=False)
    detail_scores = Column(JSONB, nullable=True)
    strengths = Column(JSONB, nullable=True)
    weaknesses = Column(JSONB, nullable=True)
    missed_content = Column(JSONB, nullable=True)
    suggestions = Column(Text, nullable=True)
    # 评分标准版本追踪
    rubric_version = Column(String(40), nullable=True)
    model_name = Column(String(80), nullable=True)
    prompt_version = Column(Integer, nullable=True, default=1)
    score_scale = Column(Integer, nullable=True, default=100)
    # 教师复核
    review_status = Column(String(20), nullable=True)  # null / reviewed
    reviewed_by = Column(Integer, nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    review_detail_scores = Column(JSONB, nullable=True)
    review_comment = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    record = relationship("TrainingRecord", back_populates="score")


class Note(Base):
    __tablename__ = "notes"
    __table_args__ = (
        Index("ix_notes_record_id", "record_id"),
    )

    id = Column(Integer, primary_key=True)
    record_id = Column(Integer, ForeignKey("training_records.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class LLMCallLog(Base):
    """记录每次 LLM 调用的元数据，用于成本监控和稳定性分析"""
    __tablename__ = "llm_call_logs"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    record_id = Column(Integer, ForeignKey("training_records.id"), nullable=True, index=True)
    case_id = Column(Integer, ForeignKey("cases.id"), nullable=True, index=True)
    purpose = Column(String(40), nullable=False, index=True)  # patient_chat / scoring / qa / summary / other
    provider_name = Column(String(40), nullable=False, default="deepseek")
    api_key_id = Column(Integer, ForeignKey("api_keys.id"), nullable=True, index=True)
    config_id = Column(Integer, ForeignKey("llm_configs.id"), nullable=True, index=True)
    model = Column(String(80), nullable=False)
    temperature = Column(Float, nullable=True)
    max_tokens = Column(Integer, nullable=True)
    prompt_tokens = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)
    total_tokens = Column(Integer, nullable=True)
    token_estimated = Column(Integer, nullable=False, default=1)  # 0=真实usage, 1=估算
    estimated_cost = Column(Float, nullable=True)
    cost_currency = Column(String(10), nullable=True, default="CNY")
    latency_ms = Column(Integer, nullable=True, index=True)
    status = Column(String(20), nullable=False, index=True)  # success / failed / timeout / rate_limited / auth_error
    error_type = Column(String(80), nullable=True, index=True)
    error_message = Column(Text, nullable=True)
    request_chars = Column(Integer, nullable=True)
    response_chars = Column(Integer, nullable=True)
    request_text = Column(Text, nullable=True)   # LLM 请求全文（调试用）
    response_text = Column(Text, nullable=True)  # LLM 回复全文（调试用）
    meta = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)

    api_key = relationship("ApiKey")
    config = relationship("LLMConfig")


class QASession(Base):
    __tablename__ = "qa_sessions"
    __table_args__ = (
        Index("ix_qa_sessions_user_updated", "user_id", "updated_at"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String(80), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    user = relationship("User")
    records = relationship("QARecord", back_populates="session", order_by="QARecord.created_at")


class QARecord(Base):
    """通用护理问答消息记录"""
    __tablename__ = "qa_records"
    __table_args__ = (
        Index("ix_qa_session_created", "session_id", "created_at"),
    )

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("qa_sessions.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)

    user = relationship("User")
    session = relationship("QASession", back_populates="records")


class ApiSecret(Base):
    """API 密钥凭证（纯认证容器，不参与路由）"""
    __tablename__ = "api_secrets"
    __table_args__ = (
        UniqueConstraint("encrypted_key", "key_suffix", name="uq_api_secret_key"),
    )

    id = Column(Integer, primary_key=True)
    label = Column(String(80), nullable=False)
    encrypted_key = Column(Text, nullable=False)
    key_suffix = Column(String(8), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    configs = relationship("LLMConfig", back_populates="secret", cascade="all, delete-orphan")


class LLMConfig(Base):
    """用途配置（计费单位 + 路由单位）"""
    __tablename__ = "llm_configs"
    __table_args__ = (
        UniqueConstraint("purpose", "priority", name="uq_llmconfig_purpose_priority"),
        Index("ix_llmconfig_purpose_priority", "purpose", "priority"),
    )

    id = Column(Integer, primary_key=True)
    secret_id = Column(Integer, ForeignKey("api_secrets.id"), nullable=False)
    label = Column(String(80), nullable=False)
    base_url = Column(String(200), nullable=False)
    model = Column(String(80), nullable=False)
    purpose = Column(String(40), nullable=False)
    priority = Column(Integer, nullable=False, default=100)

    status = Column(String(20), nullable=False, default="active")
    degraded_reason = Column(String(40), nullable=True)
    degraded_until = Column(DateTime(timezone=True), nullable=True)

    price_input_per_1m = Column(Numeric(10, 6), nullable=False, default=0)
    price_output_per_1m = Column(Numeric(10, 6), nullable=False, default=0)
    monthly_cost_limit = Column(Numeric(12, 6), nullable=True)

    call_count_today = Column(Integer, nullable=False, default=0)
    total_tokens_today = Column(BigInteger, nullable=False, default=0)
    total_cost_today = Column(Numeric(12, 6), nullable=False, default=0)
    monthly_cost_used = Column(Numeric(12, 6), nullable=False, default=0)
    stats_date = Column(Date, nullable=True)
    stats_month = Column(String(7), nullable=True)

    consecutive_failures = Column(Integer, nullable=False, default=0)
    last_used_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    secret = relationship("ApiSecret", back_populates="configs")


# DEPRECATED:
class ApiProvider(Base):
    __tablename__ = "api_providers"

    id = Column(Integer, primary_key=True)
    name = Column(String(40), unique=True, nullable=False)
    display_name = Column(String(80), nullable=False)
    base_url = Column(String(200), nullable=False)
    api_type = Column(String(20), nullable=False, default="openai_compatible")
    default_model = Column(String(80), nullable=False)
    is_enabled = Column(Boolean, nullable=False, default=True)
    priority = Column(Integer, nullable=False, default=100)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    keys = relationship("ApiKey", back_populates="provider", cascade="all, delete-orphan")


# DEPRECATED:
class ApiKey(Base):
    __tablename__ = "api_keys"

    id = Column(Integer, primary_key=True)
    provider_id = Column(Integer, ForeignKey("api_providers.id"), nullable=False)
    label = Column(String(80), nullable=False)
    encrypted_key = Column(Text, nullable=False)
    key_suffix = Column(String(8), nullable=False)
    model = Column(String(80), nullable=True)
    weight = Column(Integer, nullable=False, default=10)
    status = Column(String(20), nullable=False, default="active")
    price_input_per_1m = Column(Numeric(10, 6), nullable=False, default=0)
    price_output_per_1m = Column(Numeric(10, 6), nullable=False, default=0)
    currency = Column(String(10), nullable=False, default="CNY")
    balance = Column(Numeric(12, 6), nullable=True)
    monthly_cost_limit = Column(Numeric(12, 6), nullable=True)
    call_count_today = Column(Integer, nullable=False, default=0)
    total_tokens_today = Column(BigInteger, nullable=False, default=0)
    total_cost_today = Column(Numeric(12, 6), nullable=False, default=0)
    stats_date = Column(Date, nullable=True)
    monthly_cost_used = Column(Numeric(12, 6), nullable=False, default=0)
    stats_month = Column(String(7), nullable=True)
    consecutive_failures = Column(Integer, nullable=False, default=0)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    rate_limit_until = Column(DateTime(timezone=True), nullable=True)
    purpose = Column(String(40), nullable=False, default="*")
    priority = Column(Integer, nullable=False, default=100)
    __table_args__ = (
        Index("idx_api_keys_purpose", "purpose"),
    )
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    provider = relationship("ApiProvider", back_populates="keys")


class Feedback(Base):
    __tablename__ = "feedbacks"
    __table_args__ = (
        Index("ix_feedback_user_id", "user_id"),
        Index("ix_feedback_tag", "tag"),
        Index("ix_feedback_created_at", "created_at"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    rating = Column(Integer, nullable=False)
    tag = Column(String(20), nullable=False)
    content = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User")


class PromptTemplate(Base):
    """LLM 提示词模板"""
    __tablename__ = "prompt_templates"

    id = Column(Integer, primary_key=True)
    purpose = Column(String(40), nullable=False, index=True)
    version = Column(Integer, nullable=False, default=1)
    name = Column(String(80), nullable=True)
    system_prompt = Column(Text, nullable=False)
    user_prompt = Column(Text, nullable=True)
    template_engine = Column(String(20), nullable=False, default="format")
    variables = Column(JSONB, nullable=True)
    is_active = Column(Boolean, nullable=False, default=False)
    created_by = Column(String(80), nullable=True)
    remark = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

