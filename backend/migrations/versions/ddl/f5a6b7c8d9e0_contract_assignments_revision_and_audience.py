"""contract: assignments.case_revision_id NOT NULL / drop legacy assignments.student_ids

切片 2/3 的 **contract** 步骤（docs/15 §六、§七）：把作业表的两个「第二真相源」清掉，
只留下唯一 owner。

1. ``assignments.case_revision_id`` 收紧为 **NOT NULL** —— 作业必须引用明确的病例
   revision（发布时钉住，学员按它训练与复盘）。expand 与回填已在
   ``e5a1b2c3d4f5``（加列）+ ``e6b2c3d4e5f6``（``case_revision_id = 病例 current
   revision``）完成。若仍有 NULL 行，本迁移在 ``SET NOT NULL`` 处**直接失败**：不猜
   版本、不静默回填 —— 上线前必须先跑完 e6。
2. 删除遗留列 ``assignments.student_ids``：受众的唯一 owner 是发布时固化的快照
   ``assignment_recipients``（旧投影由 ``b2c4d6e8f0a2`` 回填）。快照接管后该列只是陈旧
   副本，留着等于第二份受众真相源。删除**单向**：downgrade 只重建空列，旧值不还原。

本文件不含任何数据操作（``ddl/`` 禁 ``op.execute()``）。

Revision ID: f5a6b7c8d9e0
Revises: f4a5b6c7d8e9
Create Date: 2026-09-26
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f5a6b7c8d9e0"
down_revision: Union[str, Sequence[str], None] = "f4a5b6c7d8e9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column("assignments", "case_revision_id", existing_type=sa.Integer(), nullable=False)
    op.drop_column("assignments", "student_ids")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column("assignments", sa.Column("student_ids", postgresql.JSONB(), nullable=True))
    op.alter_column("assignments", "case_revision_id", existing_type=sa.Integer(), nullable=True)
