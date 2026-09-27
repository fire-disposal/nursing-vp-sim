"""rename_is_test_to_is_student_practice — 训练记录的分类列改为「是不是学生练习」

旧列 ``is_test`` 的名字与语义脱节：它由**发起者权限**置位（教师/管理员开始即 True），
过滤处一律写 ``is_test == False``，于是"什么算真实练习"只能靠读过滤条件反推；前端筛选器
也把同一件事叫"排除试跑记录"。本迁移把列改名为语义正向的 ``is_student_practice``
（docs/15 §五），server_default 同步改为 true（新记录默认是学生练习，只有显式识别的
教师侧发起才被排除）。

**取值语义随之取反** —— 由紧邻的 data 迁移 ``e4f5a6b7c8d9`` 完成重标：
``is_student_practice = NOT is_test``。两个迁移必须**成对执行**（``alembic upgrade head``
一次跑完）；只执行到本步会得到名字新、取值旧的反向数据。

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-09-27

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d3e4f5a6b7c8"
down_revision: Union[str, Sequence[str], None] = "c2d3e4f5a6b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "training_records",
        "is_test",
        new_column_name="is_student_practice",
        existing_type=sa.Boolean(),
        existing_nullable=False,
        existing_server_default=sa.text("false"),
        server_default=sa.text("true"),
    )


def downgrade() -> None:
    op.alter_column(
        "training_records",
        "is_student_practice",
        new_column_name="is_test",
        existing_type=sa.Boolean(),
        existing_nullable=False,
        existing_server_default=sa.text("true"),
        server_default=sa.text("false"),
    )
