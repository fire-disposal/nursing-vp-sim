"""add training_records.workflow_id (冻结的 workflow 判别列)

临床判断训练（第二 workflow）产品化的 **Slice 0** schema 部分：训练记录必须自己能回答
「本次训练跑的是哪条 workflow」，而不是运行期读代码常量猜（docs/15 §二、§九）。

1. 加列 ``workflow_id``（``String(50)``，**NOT NULL**），列默认值 ``'history_taking'``：

   - 判别列落地前的存量训练行全部是问诊（唯一现行 workflow），因此**加列即完成回填** ——
     不按 ``case_data`` 反推、不写 ``UPDATE``（``ddl/`` 禁 ``op.execute()``）、不猜。
   - 保留列默认值与 ``models.TrainingRecord`` 声明一致（``create_all`` 的测试库同形），
     默认值不参与运行期判定：训练入口一律由钉住的 CaseRevision 显式写入
     （``modules/training/workflows.workflow_for_case_revision`` → ``record.workflow_id``），
     运行期读一律 ``workflows.workflow_for_record(record)``。
   - 登记第二个 workflow 时，应由对应切片把该列默认值撤掉（新写入必须显式给值）。

2. 本文件不含任何数据操作：回填完全由「NOT NULL + 默认值」的 DDL 完成。

downgrade：删列（单向，显式）。``workflow_id`` 是运行期判别列，旧代码不读它；删除不丢
病例内容或训练内容，只是回到「靠代码常量分派」的旧状态（旧行无从还原「声明过的 workflow」，
本列是它唯一副本）。

Revision ID: a9d0c1b2e3f4
Revises: f5a6b7c8d9e0
Create Date: 2026-09-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a9d0c1b2e3f4"
down_revision: str | Sequence[str] | None = "f5a6b7c8d9e0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: 判别列落地前所有训练行都是问诊（唯一现行 workflow）——回填值的唯一来源
LEGACY_WORKFLOW_ID = "history_taking"


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "training_records",
        sa.Column(
            "workflow_id",
            sa.String(length=50),
            nullable=False,
            server_default=LEGACY_WORKFLOW_ID,
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("training_records", "workflow_id")
