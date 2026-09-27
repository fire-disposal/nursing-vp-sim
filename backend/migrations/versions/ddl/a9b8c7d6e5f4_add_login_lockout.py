"""add_login_lockout

账号级登录失败锁定（方案 A6，见 docs/review/refactor-plan-2026-09-26.md）：
`users.failed_login_count` 记连续密码错误次数，`users.locked_until` 记锁定截止时刻。
两列均带默认值 → 存量用户直接可用（计数 0、未锁定）。

Revision ID: a9b8c7d6e5f4
Revises: f4e5f6a7b8c9
Create Date: 2026-09-27

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a9b8c7d6e5f4"
down_revision: str | Sequence[str] | None = "f4e5f6a7b8c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("failed_login_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    # 必须显式 timezone=True：naïve 列会让读回值按 UTC 解释（8 小时偏差）
    op.add_column("users", sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "locked_until")
    op.drop_column("users", "failed_login_count")
