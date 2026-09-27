"""invert_is_student_practice — 把历史行按取反重标为「学生练习 / 非学生练习」

# Manual override reason: data_only

维护者裁定（2026-09-27）：``is_test`` 的取值语义是"**不是**学生练习"（旧规则：发起者具备
``case_manage`` / ``score_review`` 即置位），新列 ``is_student_practice`` 的语义是"是学生练习"。
两者在同一组事实上互为否定，因此历史行按**取反**重标即可，不做任何推断、不补齐缺失：

* 旧 ``is_test = true``（教师/管理员试跑）→ 新 ``is_student_practice = false``；
* 旧 ``is_test = false``（学生练习）→ 新 ``is_student_practice = true``。

**已知边界（不假装能区分）**：旧模型下"用学生账号做的演示/预演"也是 ``is_test = false``，
重标后会呈现为"学生练习"。库里没有能还原这个意图的字段，因此不猜测；这类记录与新语义下
的判定（发起者是否具备教学/复核权限）无关，只能由维护者在导出时按批次/账号另行识别。

与紧邻的 ddl 迁移 ``d3e4f5a6b7c8`` 成对执行（``alembic upgrade head`` 一次跑完）。

Revision ID: e4f5a6b7c8d9
Revises: d3e4f5a6b7c8
Create Date: 2026-09-27

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e4f5a6b7c8d9"
down_revision: Union[str, Sequence[str], None] = "d3e4f5a6b7c8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE training_records SET is_student_practice = NOT is_student_practice")


def downgrade() -> None:
    """取反是对合运算：回退即再取反一次（不丢信息，可往返）。"""
    op.execute("UPDATE training_records SET is_student_practice = NOT is_student_practice")
