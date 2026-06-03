class ApiSecret(Base):
    """API 档案 — 一份 API 连接的全部信息（密钥、端点、计费、状态）"""
    __tablename__ = "api_secrets"
    __table_args__ = (
        UniqueConstraint("encrypted_key", "key_suffix", name="uq_api_secret_key"),
    )

    id = Column(Integer, primary_key=True)
    label = Column(String(80), nullable=False)
    encrypted_key = Column(Text, nullable=False)
    key_suffix = Column(String(8), nullable=False)
    base_url = Column(String(200), nullable=False, default="")

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

    configs = relationship("LLMConfig", back_populates="secret", cascade="all, delete-orphan")


class LLMConfig(Base):
    """用途指派 — 某档案的某模型用于某用途"""
    __tablename__ = "llm_configs"
    __table_args__ = (
        UniqueConstraint("secret_id", "purpose", name="uq_llmconfig_profile_purpose"),
    )

    id = Column(Integer, primary_key=True)
    secret_id = Column(Integer, ForeignKey("api_secrets.id"), nullable=False)
    model = Column(String(80), nullable=False)
    purpose = Column(String(40), nullable=False)
    status = Column(String(20), nullable=False, default="active")

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    secret = relationship("ApiSecret", back_populates="configs")