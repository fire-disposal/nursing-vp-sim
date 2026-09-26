"""expand case lifecycle: cases.status / current_revision_id + case_revisions + revision refs

切片 3（docs/15 §六）的 expand 步骤：只加结构，不搬数据、不改语义。
- ``cases.status``（draft/published/archived）与 ``cases.current_revision_id``
- ``case_revisions``：病例内容不可变版本（revision_no 在病例内唯一）
- ``training_records.case_revision_id`` / ``assignments.case_revision_id``：训练与作业
  钉住具体版本（内容由随后的 data 迁移回填）

数据迁移（同批 data/ 步骤）负责：status 映射、revision 1 回填、case_data 剥离元数据、
以及把 revision 引用写进训练记录与作业。

Revision ID: e5a1b2c3d4f5
Revises: b2c4d6e8f0a2
Create Date: 2026-09-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e5a1b2c3d4f5"
down_revision: str | Sequence[str] | None = "b2c4d6e8f0a2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_FK_CURRENT_REVISION = "fk_cases_current_revision_id"
_FK_RECORD_REVISION = "fk_training_records_case_revision_id"
_FK_ASSIGNMENT_REVISION = "fk_assignments_case_revision_id"


def upgrade() -> None:
    op.create_table(
        "case_revisions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("case_id", sa.Integer(), nullable=False),
        sa.Column("revision_no", sa.Integer(), nullable=False),
        sa.Column("content", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["case_id"], ["cases.id"], name="fk_case_revisions_case_id", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], name="fk_case_revisions_created_by", ondelete="SET NULL"),
        sa.UniqueConstraint("case_id", "revision_no", name="uq_case_revisions_case_revision_no"),
    )
    op.create_index("ix_case_revisions_case_id", "case_revisions", ["case_id"])

    op.add_column("cases", sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"))
    op.add_column("cases", sa.Column("current_revision_id", sa.Integer(), nullable=True))
    # 表间环（cases → case_revisions → cases）在建表后补 FK
    op.create_foreign_key(
        _FK_CURRENT_REVISION, "cases", "case_revisions", ["current_revision_id"], ["id"], ondelete="SET NULL"
    )
    op.create_check_constraint("ck_cases_status", "cases", "status IN ('draft', 'published', 'archived')")

    op.add_column("training_records", sa.Column("case_revision_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        _FK_RECORD_REVISION,
        "training_records",
        "case_revisions",
        ["case_revision_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_tr_case_revision", "training_records", ["case_revision_id"])

    op.add_column("assignments", sa.Column("case_revision_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        _FK_ASSIGNMENT_REVISION,
        "assignments",
        "case_revisions",
        ["case_revision_id"],
        ["id"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    op.drop_constraint(_FK_ASSIGNMENT_REVISION, "assignments", type_="foreignkey")
    op.drop_column("assignments", "case_revision_id")

    op.drop_index("ix_tr_case_revision", table_name="training_records")
    op.drop_constraint(_FK_RECORD_REVISION, "training_records", type_="foreignkey")
    op.drop_column("training_records", "case_revision_id")

    op.drop_constraint("ck_cases_status", "cases", type_="check")
    op.drop_constraint(_FK_CURRENT_REVISION, "cases", type_="foreignkey")
    op.drop_column("cases", "current_revision_id")
    op.drop_column("cases", "status")

    op.drop_index("ix_case_revisions_case_id", table_name="case_revisions")
    op.drop_table("case_revisions")
