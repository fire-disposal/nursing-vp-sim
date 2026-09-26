"""审计日志模型（**append-only**）。

只追加的三层保证里的第一层（见 `core/audit.py` 模块 docstring 与 `tests/core/test_audit_writer.py`）：

1. 模型没有 `updated_at`，`core/audit.py` 只暴露 `record()` / `record_detached()`，不提供 update/delete；
2. 守卫测试断言"模块里没有对 AuditLog 的 update/delete"，并断言本模型无 `updated_at`；
3. DB 层触发器/受限角色（A6，见 `docs/review/refactor-plan-2026-09-26.md`）。

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
