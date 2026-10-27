"""收紧院校列：``classes.school_id`` NOT NULL（contract 步骤）。

班级没有院校等于跨校可见的孤儿行，必须在库层拒绝。``users.school_id`` 保持可空：
NULL 是「平台角色」的合法取值（super_admin）。

执行前若仍有 ``school_id IS NULL`` 的班级（例如空库但有人手工插过），PG 会在
``SET NOT NULL`` 处拒绝并整条回滚 —— 刻意 fail-closed，不替操作者猜归属。

Revision ID: b7c1d9e4a2f7
Revises: b7c1d9e4a2f6
Create Date: 2026-10-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b7c1d9e4a2f7"
down_revision: Union[str, Sequence[str], None] = "b7c1d9e4a2f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("classes", "school_id", existing_type=sa.Integer(), nullable=False)


def downgrade() -> None:
    op.alter_column("classes", "school_id", existing_type=sa.Integer(), nullable=True)
