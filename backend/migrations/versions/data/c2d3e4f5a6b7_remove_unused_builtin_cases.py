"""remove_unused_builtin_cases — 删除零练习记录的病例（含一个内置病例）

# Manual override reason: data_only

维护者裁定（2026-09-27）：病例库只保留**被真实练习过**的病例；零训练记录且零作业引用的
病例删除。生产盘点（554 条训练记录 / 10 个被用过的病例）确定三个可删对象：

* ``小儿发热伴抽搐``（内置病例，随附删除 ``data/cases/case6.json`` —— 只删库行的话，
  下次启动 ``seed.py::_seed_cases`` 会按文件重建它）；
* ``急性胸痛``、``高热伴意识模糊``（无对应文件的归档遗留行）。

守卫（**按名字删除，绝不按 id** —— 各环境 id 不一致；本地验证库的 id 与生产完全不同）：

* 只删名字在允许清单内的行；
* 且 ``training_records`` / ``assignments`` / ``llm_call_logs`` 三处引用**全为 0**
  （这三条外键在库层面都是 NO ACTION，被用过的病例删不动；这里再显式判一次，
  保证在任何一个环境里同名病例被用过时本迁移都会跳过它，绝不误删学生历史）。

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-09-27

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c2d3e4f5a6b7"
down_revision: Union[str, Sequence[str], None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: 允许删除的病例名（跨环境稳定的标识；与文件名/库 id 无关）
UNUSED_CASE_NAMES = ("小儿发热伴抽搐", "急性胸痛", "高热伴意识模糊")


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM cases c
        WHERE c.name IN ('小儿发热伴抽搐', '急性胸痛', '高热伴意识模糊')
          AND NOT EXISTS (SELECT 1 FROM training_records t WHERE t.case_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.case_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM llm_call_logs l WHERE l.case_id = c.id)
        """
    )


def downgrade() -> None:
    """数据清理不可逆（内置病例可由 data/cases/*.json 重新 seed，遗留行不回填）。"""
    pass
