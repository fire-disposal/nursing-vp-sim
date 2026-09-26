"""持久化 Job —— 可离线完成、可重试、可观测的后台工作单元。

设计：docs/ideas/pipeline-and-job-separation.md。要点：

* 认领走 ``FOR UPDATE SKIP LOCKED``，无长事务、无锁等待；
* **租约**而非"连接存活"来判断执行者是否还活着：心跳续租，租约过期即可被重领 —— 进程被杀
  （发版、OOM）不再需要人工介入，也不需要依赖记录状态扫描来猜；
* 尝试次数与失败原因落库：`/end` 触发的评分失败，事后可回答"试了几次、为什么失败"。

状态机（终态不可回到 pending）：

    pending ──claim──▶ running ──ok──▶ succeeded
       ▲                  │
       └── lease expired ──┴── attempts exhausted ──▶ failed

本表不保存评分输入：``case_snapshot`` 在记录上，认领者按 ``record_id`` 派生即可 ——
payload 只放**无法从记录派生**的东西（当前没有），避免同一事实两份拷贝（docs/17 §四）。
"""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models._base import _now_utc

JOB_KIND_SCORING = "scoring"
JOB_KINDS = (JOB_KIND_SCORING,)

JOB_STATUS_PENDING = "pending"
JOB_STATUS_RUNNING = "running"
JOB_STATUS_SUCCEEDED = "succeeded"
JOB_STATUS_FAILED = "failed"
JOB_ACTIVE_STATUSES = (JOB_STATUS_PENDING, JOB_STATUS_RUNNING)
JOB_STATUSES = (JOB_STATUS_PENDING, JOB_STATUS_RUNNING, JOB_STATUS_SUCCEEDED, JOB_STATUS_FAILED)


class Job(Base):
    """一行 = 一次待执行/执行中的后台工作。不可变字段：kind/record_id/payload/created_at。"""

    __tablename__ = "jobs"
    __table_args__ = (
        # 认领路径：按 kind+可用时间 找最老的可执行任务
        Index(
            "ix_jobs_claim",
            "kind",
            "status",
            "available_at",
            "priority",
            "id",
        ),
        # 同一记录的评分不得同时挂起两条（记录自身的 scoring_status 仍是执行期仲裁者，
        # 这条索引只是"重复入队"的结构性防御）
        Index(
            "uq_jobs_active_scoring",
            "record_id",
            unique=True,
            postgresql_where=text("kind = 'scoring' AND status IN ('pending', 'running')"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    record_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("training_records.id", ondelete="CASCADE", name="fk_jobs_record_id"), nullable=True
    )
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=JOB_STATUS_PENDING, server_default=text("'pending'")
    )
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=2, server_default=text("2"))
    #: 早于此时间不认领（失败退避 / 延迟任务）
    available_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now_utc, server_default=text("NOW()")
    )
    #: 执行者标识（``{role}:{host}:{pid}``）：心跳与重领的归属凭据
    lease_owner: Mapped[str | None] = mapped_column(String(120), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now_utc, server_default=text("NOW()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now_utc, server_default=text("NOW()"), onupdate=_now_utc
    )
