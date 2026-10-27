"""院校（租户）实体与 school_id 列 —— expand 步骤。

只加结构、不动数据：``schools`` 表 + ``classes.school_id`` / ``users.school_id``（可空）。
回填与 NOT NULL 收紧分别在 data 迁移与 contract 迁移里（ddl 禁 ``op.execute``）。

唯一键同时扩成 ``(school_id, cohort_label, name)``：学校隔离后，同名班级可以跨校存在。
``school_id`` 为 NULL 时 PG 视为各不相同，所以在回填前加上也不会误撞。

Revision ID: b7c1d9e4a2f5
Revises: c6e9a4b3d7f1
Create Date: 2026-10-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b7c1d9e4a2f5"
down_revision: Union[str, Sequence[str], None] = "c6e9a4b3d7f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "schools",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("name", name="uq_schools_name"),
    )

    op.add_column("classes", sa.Column("school_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "classes_school_id_fkey", "classes", "schools", ["school_id"], ["id"], ondelete="RESTRICT"
    )
    op.create_index("ix_classes_school_id", "classes", ["school_id"])

    op.add_column("users", sa.Column("school_id", sa.Integer(), nullable=True))
    op.create_foreign_key("users_school_id_fkey", "users", "schools", ["school_id"], ["id"], ondelete="RESTRICT")
    op.create_index("ix_users_school_id", "users", ["school_id"])

    op.drop_constraint("uq_classes_cohort_label_name", "classes", type_="unique")
    op.create_unique_constraint("uq_classes_school_cohort_name", "classes", ["school_id", "cohort_label", "name"])


def downgrade() -> None:
    op.drop_constraint("uq_classes_school_cohort_name", "classes", type_="unique")
    op.create_unique_constraint("uq_classes_cohort_label_name", "classes", ["cohort_label", "name"])

    op.drop_index("ix_users_school_id", table_name="users")
    op.drop_constraint("users_school_id_fkey", "users", type_="foreignkey")
    op.drop_column("users", "school_id")

    op.drop_index("ix_classes_school_id", table_name="classes")
    op.drop_constraint("classes_school_id_fkey", "classes", type_="foreignkey")
    op.drop_column("classes", "school_id")

    op.drop_table("schools")
