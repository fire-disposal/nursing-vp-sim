"""platformize school-level ops accounts

# Manual override reason: data_only

`ops` 是跨院校的系统面（密钥、审计、成本、诊断），院校账号持有它既没有正确的
院校作用域，也会在选校后四处 403。新授权入口已经拒绝院校账号持有 `ops`；
这里只处理历史上真正持有 `ops` 的账号：整体平台化，并清掉它们的院校残留。
不动其它平台账号 —— 那不是本迁移的对象。

Revision ID: d0c4e6a8b2f1
Revises: c9f3a7b2d6e1
Create Date: 2026-11-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d0c4e6a8b2f1"
down_revision: str | Sequence[str] | None = "c9f3a7b2d6e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "CREATE TEMP TABLE ops_platformized ON COMMIT DROP AS "
            "SELECT DISTINCT user_id FROM user_school_personas WHERE persona = 'ops'"
        )
    )
    # 历史院校级运维账号：账号整体升为平台账号，不再保留任何院校归属。
    bind.execute(
        sa.text(
            "UPDATE users SET is_platform = true, school_id = NULL, updated_at = now() "
            "WHERE is_platform = false AND id IN (SELECT user_id FROM ops_platformized)"
        )
    )
    # 平台账号派生拥有全部视角：显式授予、院校档案、班级成员关系都不再成立。
    for table in ("user_school_personas", "user_school_profiles", "user_class"):
        bind.execute(
            sa.text(
                f"DELETE FROM {table} WHERE user_id IN "
                "(SELECT user_id FROM ops_platformized)"
            )
        )


def downgrade() -> None:
    # 平台化不可逆：迁移前的院校归属与显式授予没有留档，猜一个会制造新的越权账号。
    pass
