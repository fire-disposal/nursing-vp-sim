"""contract: drop cases.training_type / training_records.training_type

切片 3（docs/15 §九）：``training_type`` 是「单字段总分派」的遗迹 —— 字段退场后
Workflow 由路由/manifest 决定。落库侧最后两处（``cases`` 与 ``training_records``）
在 e6b2c3d4e5f6 完成数据搬迁后删除：

- 病例侧的类型没有任何读点（列表过滤改为 status，见 modules/cases/service.py）；
- 训练记录侧的类型没有读点（内容随 case_snapshot + case_revision_id 冻结）。

downgrade 以 server_default 恢复两列（历史值不可还原，回到默认 history_taking）。

Revision ID: e7c3d4e5f6a7
Revises: e6b2c3d4e5f6
Create Date: 2026-09-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e7c3d4e5f6a7"
down_revision: str | Sequence[str] | None = "e6b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("training_records", "training_type")
    op.drop_column("cases", "training_type")


def downgrade() -> None:
    op.add_column(
        "cases",
        sa.Column("training_type", sa.String(length=50), nullable=False, server_default="history_taking"),
    )
    op.add_column(
        "training_records",
        sa.Column("training_type", sa.String(length=50), nullable=False, server_default="history_taking"),
    )
