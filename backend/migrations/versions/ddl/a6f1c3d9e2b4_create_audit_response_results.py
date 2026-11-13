"""create_audit_response_results

每次 `/api/` 业务请求的**真实 HTTP 结果**（200/201/403/500 一视同仁）。

`audit_logs` 是只追加表，响应状态码只能等响应生成后才知道，因此单独建一张附属表，
由 `main._log_requests` 在响应生成后插入：

- 有审计事件：每个事件一行（`audit_log_id` 指向它，**唯一约束**保证一事一行）；
- 没有任何事件（普通 GET / 纯读取）：一行 `audit_log_id IS NULL`，表示"这次请求本身"；
- `request_key`：服务端每次请求新生成的实例键。客户端的 `X-Request-ID` 只是关联 ID，
  可以重复发送，用它做归属键会把不同请求的状态码串在一起；`request_key` 不会。
- `(request_key, audit_log_id)` 联合唯一：重复 attach 幂等（`audit_log_id` 为 NULL 时
  PG 的唯一约束靠 `request_key` 单独成立 —— NULL 之间互不相等）；
- 只插入：没有 updated_at，也没有任何 update 路径（`core/audit.py::attach_response_status`
  只 `add_all`）；`audit_logs` 已禁止 DELETE（触发器），`ON DELETE CASCADE` 只是外键兜底；
- 历史审计行没有结果 → 查询侧按 `None` 处理（列表 `response_status=None`、导出空列）。

Revision ID: a6f1c3d9e2b4
Revises: d0c4e6a8b2f1
Create Date: 2026-11-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a6f1c3d9e2b4"
down_revision: str | Sequence[str] | None = "d0c4e6a8b2f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema: 建请求响应结果表（只插入的附属表）。"""
    op.create_table(
        "audit_response_results",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("audit_log_id", sa.BigInteger(), nullable=True),
        sa.Column("request_key", sa.String(length=64), nullable=False),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        sa.Column("request_method", sa.String(length=10), nullable=True),
        sa.Column("request_path", sa.String(length=200), nullable=True),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["audit_log_id"],
            ["audit_logs.id"],
            name="fk_audit_response_results_audit_log_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("audit_log_id", name="uq_audit_response_results_audit_log_id"),
        sa.UniqueConstraint("request_key", "audit_log_id", name="uq_audit_response_results_request_key_event"),
    )
    # 请求实例键（幂等落点 / 排障时按请求聚合）
    op.create_index(
        "ix_audit_response_results_request_key",
        "audit_response_results",
        ["request_key"],
        unique=False,
    )
    # 「按响应码排障」的面板：某个状态码什么时候冒出来
    op.create_index(
        "ix_audit_response_results_status_created",
        "audit_response_results",
        ["status_code", sa.text("created_at DESC")],
        unique=False,
    )
    # 与审计行同口径的 request_id 关联（客户端可复用，故不唯一）
    op.create_index(
        "ix_audit_response_results_request_id",
        "audit_response_results",
        ["request_id"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema: 丢结果表（`audit_logs` 本身不受影响，只是失去状态码）。"""
    op.drop_index("ix_audit_response_results_request_id", table_name="audit_response_results")
    op.drop_index("ix_audit_response_results_status_created", table_name="audit_response_results")
    op.drop_index("ix_audit_response_results_request_key", table_name="audit_response_results")
    op.drop_table("audit_response_results")
