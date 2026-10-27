"""回填院校：现有全部班级与账号归属「杭州师范大学」。

# Manual override reason: data_only

口径（用户 2026-10-27 确认）：当前库里的班级、届别、用户、管理员全部属于杭州师范大学；
将来的院校由超级管理员在院校管理里新建。``super_admin`` 一律保持 ``school_id = NULL``
（= 平台角色，跨院校可见），不参与回填。

只在**确有存量数据**时建默认院校：空库（新环境、测试库）留空，由管理员自己建第一所院校，
避免把测试数据硬绑到一个真实院校上。

Revision ID: b7c1d9e4a2f6
Revises: b7c1d9e4a2f5
Create Date: 2026-10-27
"""

from typing import Sequence, Union

from alembic import op

revision: str = "b7c1d9e4a2f6"
down_revision: Union[str, Sequence[str], None] = "b7c1d9e4a2f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DEFAULT_SCHOOL = "杭州师范大学"


def upgrade() -> None:
    op.execute(
        f"""
        INSERT INTO schools (name, created_at)
        SELECT '{DEFAULT_SCHOOL}', now()
        WHERE (
            EXISTS (SELECT 1 FROM classes)
            OR EXISTS (SELECT 1 FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name <> 'super_admin')
        )
        AND NOT EXISTS (SELECT 1 FROM schools WHERE name = '{DEFAULT_SCHOOL}')
        """
    )
    op.execute(
        f"""
        UPDATE classes SET school_id = (SELECT id FROM schools WHERE name = '{DEFAULT_SCHOOL}')
        WHERE school_id IS NULL
        """
    )
    op.execute(
        f"""
        UPDATE users SET school_id = (SELECT id FROM schools WHERE name = '{DEFAULT_SCHOOL}')
        WHERE school_id IS NULL
          AND role_id NOT IN (SELECT id FROM roles WHERE name = 'super_admin')
        """
    )


def downgrade() -> None:
    # 数据迁移不可逆（不知道哪些账号原本没有院校），只把列清空让结构迁移收尾。
    op.execute("UPDATE users SET school_id = NULL")
    op.execute("UPDATE classes SET school_id = NULL")
