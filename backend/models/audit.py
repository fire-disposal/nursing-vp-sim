"""审计日志模型（**append-only**）。

只追加的三层保证里的第一层（见 `core/audit.py` 模块 docstring 与 `tests/core/test_audit_writer.py`）：

1. 模型没有 `updated_at`，`core/audit.py` 只暴露 `record()` / `record_detached()`，不提供 update/delete；
2. 守卫测试断言"模块里没有对 AuditLog 的 update/delete"，并断言本模型无 `updated_at`；
3. DB 层触发器/受限角色（A6）。

`AuditResponseResult` 是每次 **`/api/` 业务请求**的真实 HTTP 结果（审计事件的补充，不是它的字段）：
HTTP 状态码只有等响应生成后才知道，而 `audit_logs` 是只追加表，事后 `UPDATE audit_logs.outcome`
既不可行也不该做。因此结果单独成表，由中间件在响应生成后写入：

- 一个请求产生 N 个审计事件 → N 行（各自 `audit_log_id` 唯一）；
- 一个请求没有任何审计事件 → 1 行 `audit_log_id IS NULL`（纯读取也要能回答"这次回没回 5xx"）；
- `request_key` 是**服务端每次请求新生成的实例键**（`request.state.audit_request_key`）：
  客户端可以重复发同一个 `X-Request-ID`，状态码只允许挂在明确的请求实例上，不能串；
- 历史审计行没有结果 = `None`。`outcome` 仍只表达"业务结果"，与响应状态码互不推导。

`actor_*` 存**快照**：`actor_id` 用 `ON DELETE SET NULL`（删用户不得连带删掉它的审计），
但 ID 被置空后仍要能回答"谁做的"，所以同时存 username / display_name / role 名。
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base

AUDIT_OUTCOME_SUCCESS = "success"
AUDIT_OUTCOME_DENIED = "denied"
AUDIT_OUTCOME_FAILURE = "failure"
AUDIT_OUTCOMES = (AUDIT_OUTCOME_SUCCESS, AUDIT_OUTCOME_DENIED, AUDIT_OUTCOME_FAILURE)


def _now_utc() -> datetime:
    return datetime.now(UTC)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    # 审计量远超其它表 → BIGSERIAL（本仓面向 PG，不做跨库降级）
    id: Mapped[int] = mapped_column(sa.BigInteger, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), default=_now_utc, server_default=sa.text("NOW()"), nullable=False
    )

    # 操作者：ID 可空（删用户后 SET NULL），快照列让历史仍可读
    actor_id: Mapped[int | None] = mapped_column(
        sa.Integer,
        sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_audit_logs_actor_id"),
        nullable=True,
    )
    actor_username: Mapped[str | None] = mapped_column(sa.String(50), nullable=True)
    actor_display_name: Mapped[str | None] = mapped_column(sa.String(50), nullable=True)
    actor_role: Mapped[str | None] = mapped_column(sa.String(20), nullable=True)
    #: 操作时**生效的视角**（`X-View-Persona`）。同一账号可持多个视角，
    #: 只有角色名无法回答"当时是以管理员还是教师身份做的"。
    #: 无视角的老数据/自定义角色为空，或记为 `role.name`。
    actor_persona: Mapped[str | None] = mapped_column(sa.String(20), nullable=True)

    action: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    target_type: Mapped[str] = mapped_column(sa.String(32), nullable=False)
    target_id: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    target_label: Mapped[str | None] = mapped_column(sa.String(120), nullable=True)
    outcome: Mapped[str] = mapped_column(
        sa.String(16), default=AUDIT_OUTCOME_SUCCESS, server_default=sa.text("'success'"), nullable=False
    )
    payload: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=sa.text("'{}'::jsonb"), nullable=False
    )
    error_detail: Mapped[str | None] = mapped_column(sa.String(500), nullable=True)

    request_id: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    ip: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    request_method: Mapped[str | None] = mapped_column(sa.String(10), nullable=True)
    request_path: Mapped[str | None] = mapped_column(sa.String(200), nullable=True)

    __table_args__ = (
        sa.Index("ix_audit_logs_created_at", "created_at"),
        sa.Index("ix_audit_logs_actor_created", "actor_id", sa.text("created_at DESC")),
        sa.Index("ix_audit_logs_action_created", "action", sa.text("created_at DESC")),
        sa.Index("ix_audit_logs_target", "target_type", "target_id"),
        sa.Index(
            "ix_audit_logs_outcome_created",
            "outcome",
            sa.text("created_at DESC"),
            postgresql_where=sa.text("outcome <> 'success'"),
        ),
        sa.CheckConstraint("outcome IN ('success', 'denied', 'failure')", name="ck_audit_logs_outcome"),
    )


class AuditResponseResult(Base):
    """一次 `/api/` 请求的真实 HTTP 结果（**只插入**）。

    语义约束：
    - `audit_log_id` 可空且**唯一**：有审计事件时一事件一行；没有事件时留
      `NULL` 表示"这次请求本身"。（唯一约束在 PG 里天然允许多个 NULL。）
    - `(request_key, audit_log_id)` 联合唯一是幂等落点：同一请求实例重复 attach、
      或同一事件的重复投递，都只能跳过而不能追加第二行；
    - `request_key` 是服务端生成的请求实例键，`request_id` 是（可能被客户端复用的）
      关联 ID —— 两者都存，才能在 `X-Request-ID` 撞车时仍然分得清状态码归属；
    - 只插入、不 update/delete（`tests/core/test_audit_response_result.py` 守卫）：
      `audit_logs` 不可改写，其附属结果同样不该被改写；
    - 状态码原样记录真实响应（200/201/403/500 都一样），不据 `outcome` 推断、也不回写。
    """

    __tablename__ = "audit_response_results"

    id: Mapped[int] = mapped_column(sa.BigInteger, primary_key=True, autoincrement=True)
    audit_log_id: Mapped[int | None] = mapped_column(
        sa.BigInteger,
        sa.ForeignKey("audit_logs.id", ondelete="CASCADE", name="fk_audit_response_results_audit_log_id"),
        nullable=True,
    )
    #: 服务端每次请求新生成（`core.audit.request_key`）；客户端无法预置或复发
    request_key: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    #: 与 `audit_logs.request_id` 同一口径（客户端可传 `X-Request-ID` 复用）
    request_id: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    request_method: Mapped[str | None] = mapped_column(sa.String(10), nullable=True)
    request_path: Mapped[str | None] = mapped_column(sa.String(200), nullable=True)
    status_code: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), default=_now_utc, server_default=sa.text("NOW()"), nullable=False
    )

    __table_args__ = (
        sa.UniqueConstraint("audit_log_id", name="uq_audit_response_results_audit_log_id"),
        # NULL 在 PG 的唯一约束里互不相等 —— 所以"无事件的请求结果"幂等要靠这一条
        sa.UniqueConstraint("request_key", "audit_log_id", name="uq_audit_response_results_request_key_event"),
        sa.Index("ix_audit_response_results_request_key", "request_key"),
        sa.Index("ix_audit_response_results_status_created", "status_code", sa.text("created_at DESC")),
        sa.Index("ix_audit_response_results_request_id", "request_id"),
    )
