"""expand class memberships (cohort_label / member_role) and assignment audience (audience_mode / recipients)

单用户多班级成员模型的 **expand** 步骤（本轮不 drop 任何旧结构）：

  - ``classes.cohort_label``（届/年级标签）取代 ``grades`` 归属；``classes.grade_id`` 降为
    nullable，与 ``grades`` 表一起保留为回滚源 —— 本轮新代码不再写入 ``grade_id``。
  - ``user_class.member_role``（student/teacher）+ CHECK（表名沿用 ``user_class``）。
  - ``assignments.audience_mode``（class/selected）+ CHECK，新增受众快照表
    ``assignment_recipients``（PRIMARY KEY(assignment_id, user_id)，两侧 FK 均 CASCADE）。

本文件不含任何数据操作（``ddl/`` 禁 ``op.execute()``）：
``cohort_label`` / ``member_role`` / ``audience_mode`` 的回填与 ``student_ids`` →
``assignment_recipients`` 的投影见紧随其后的 data 迁移 ``b2c4d6e8f0a2``。

两条唯一约束（``uq_user_class_user_id_class_id``、``uq_classes_cohort_label_name``）在 data
迁移里建立：前者要求先按 ``(user_id, class_id)`` 去重，后者要求 ``cohort_label`` 已回填，
否则约束创建会直接失败 —— 顺序上只能落在回填之后。

Revision ID: b2c4d6e8f0a1
Revises: c9a7e2f4b6d8
Create Date: 2026-09-25

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b2c4d6e8f0a1"
down_revision: Union[str, Sequence[str], None] = "c9a7e2f4b6d8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # ── classes：cohort 标签；grade_id 退为 nullable（回滚源，保留旧唯一约束与索引）──
    op.add_column(
        "classes",
        sa.Column("cohort_label", sa.String(length=40), nullable=False, server_default=sa.text("''")),
    )
    op.alter_column("classes", "grade_id", existing_type=sa.Integer(), nullable=True)

    # ── user_class：成员角色（学生/教师）──
    op.add_column(
        "user_class",
        sa.Column("member_role", sa.String(length=20), nullable=False, server_default=sa.text("'student'")),
    )
    op.create_check_constraint("ck_user_class_member_role", "user_class", "member_role IN ('student', 'teacher')")

    # ── assignments：受众模式 ──
    op.add_column(
        "assignments",
        sa.Column("audience_mode", sa.String(length=20), nullable=False, server_default=sa.text("'class'")),
    )
    op.create_check_constraint("ck_assignments_audience_mode", "assignments", "audience_mode IN ('class', 'selected')")

    # ── 作业受众快照表 ──
    op.create_table(
        "assignment_recipients",
        sa.Column("assignment_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["assignment_id"], ["assignments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("assignment_id", "user_id"),
    )
    op.create_index("ix_assignment_recipients_user_id", "assignment_recipients", ["user_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_assignment_recipients_user_id", table_name="assignment_recipients")
    op.drop_table("assignment_recipients")
    op.drop_constraint("ck_assignments_audience_mode", "assignments", type_="check")
    op.drop_column("assignments", "audience_mode")
    op.drop_constraint("ck_user_class_member_role", "user_class", type_="check")
    op.drop_column("user_class", "member_role")
    # 还原旧结构要求 grade_id NOT NULL；上一步 data 迁移的 downgrade 已把 NULL 行补回 grade_id。
    op.alter_column("classes", "grade_id", existing_type=sa.Integer(), nullable=False)
    op.drop_column("classes", "cohort_label")
