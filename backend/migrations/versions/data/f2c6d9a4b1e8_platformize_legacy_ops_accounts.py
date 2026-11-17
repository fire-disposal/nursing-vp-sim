"""platformize legacy accounts still holding ops

`c5a8e1f3d7b2` 把库里遗留的 `platform` 授予原地改成 `ops`，但没有同步账号身份；
于是院校账号可能持有 ops：登录时 ops 参与默认视角排序，命中
`requires_superadmin` 闸门后直接 403，账号会被锁在登录之外。

本迁移把这些历史操作者提升为超级管理员，并按超管不变量清掉院校归属、视角授予、
学号档案与班级成员关系。升级不可回退：旧的院校归属没有留档，和 `d0c4e6a8b2f1`
平台化迁移同一口径。

# Manual override reason: data_only

Revision ID: f2c6d9a4b1e8
Revises: e3b7a1c9d5f2
Create Date: 2026-11-17
"""

from collections.abc import Sequence

from alembic import op

revision: str = "f2c6d9a4b1e8"
down_revision: str | Sequence[str] | None = "e3b7a1c9d5f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_LEGACY = "_legacy_ops_users"


def upgrade() -> None:
    """Upgrade data: 持 ops 的非超管账号 = 历史平台操作者，提升为超管并清理院校行。"""
    op.execute(
        f"""
        CREATE TEMP TABLE {_LEGACY} ON COMMIT DROP AS
        SELECT DISTINCT p.user_id AS id
        FROM user_school_personas p
        JOIN users u ON u.id = p.user_id
        WHERE p.persona = 'ops' AND u.is_superadmin IS FALSE
        """
    )
    op.execute(
        f"""
        UPDATE users
        SET is_superadmin = TRUE, school_id = NULL, updated_at = now()
        WHERE id IN (SELECT id FROM {_LEGACY})
        """
    )
    # 超管派生全部视角：不保留任何逐院校授予/档案/成员关系。
    op.execute("DELETE FROM user_school_personas WHERE user_id IN (SELECT id FROM users WHERE is_superadmin)")
    op.execute("DELETE FROM user_school_profiles WHERE user_id IN (SELECT id FROM users WHERE is_superadmin)")
    op.execute("DELETE FROM user_class WHERE user_id IN (SELECT id FROM users WHERE is_superadmin)")


def downgrade() -> None:
    """Downgrade data: 不可逆。身份提升没有可还原的原始院校归属。"""
    return
