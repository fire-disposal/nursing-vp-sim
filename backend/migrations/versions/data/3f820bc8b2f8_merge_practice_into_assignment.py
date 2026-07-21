"""merge_practice_into_assignment — Practice 模型廃止、Assignment へ統合

# Manual override reason: data_only
Practice テーブルを廃止し、そのフィールド（case_id, features, behavior）を
Assignment に直接統合。既存データを移行するため op.execute() を伴う。

Revision ID: 3f820bc8b2f8
Revises: 668275f4cf14
Create Date: 2026-07-21 12:08:31.738219

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "3f820bc8b2f8"
down_revision: Union[str, Sequence[str], None] = "668275f4cf14"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Step 1: Add new columns to assignments (nullable first)
    op.add_column("assignments", sa.Column("case_id", sa.Integer(), nullable=True))
    op.add_column(
        "assignments",
        sa.Column("features", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.add_column(
        "assignments",
        sa.Column("behavior", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.add_column("assignments", sa.Column("student_ids", postgresql.JSONB(), nullable=True))

    # Step 2: Copy data from practices → assignments
    op.execute(
        sa.text(
            """
        UPDATE assignments SET
          case_id = p.case_id,
          features = p.features,
          behavior = p.behavior
        FROM practices p
        WHERE assignments.practice_id = p.id
        """
        )
    )

    # Step 3: Make case_id NOT NULL (all rows now have data)
    op.alter_column("assignments", "case_id", nullable=False)

    # Step 4: Add FK and index for case_id
    op.create_foreign_key("fk_assignments_case_id", "assignments", "cases", ["case_id"], ["id"])
    op.create_index("ix_assignments_case", "assignments", ["case_id"])

    # Step 5: Drop practice_id from assignments
    op.drop_constraint("assignments_practice_id_fkey", "assignments", type_="foreignkey")
    op.drop_index("ix_assignments_practice", table_name="assignments")
    op.drop_column("assignments", "practice_id")

    # Step 6: Drop practice_id from training_records
    op.drop_constraint("fk_training_records_practice_id", "training_records", type_="foreignkey")
    op.drop_index("ix_tr_practice_id", table_name="training_records")
    op.drop_column("training_records", "practice_id")

    # Step 7: Drop practices table
    op.drop_table("practices")


def downgrade() -> None:
    # Step 1: Recreate practices table
    op.create_table(
        "practices",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("case_id", sa.Integer(), nullable=False),
        sa.Column("features", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("behavior", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_practices_case_id", "practices", ["case_id"])
    op.create_foreign_key(None, "practices", "cases", ["case_id"], ["id"])

    # Step 2: Re-add practice_id to assignments
    op.add_column("assignments", sa.Column("practice_id", sa.Integer(), nullable=True))
    op.create_index("ix_assignments_practice", "assignments", ["practice_id"])

    # Step 3: Re-add practice_id to training_records (nullable)
    op.add_column("training_records", sa.Column("practice_id", sa.Integer(), nullable=True))
    op.create_index("ix_tr_practice_id", "training_records", ["practice_id"])

    # Step 4: Recreate practice rows from assignment data
    op.execute(
        sa.text(
            """
        INSERT INTO practices (case_id, features, behavior, name, description, is_active)
        SELECT a.case_id, a.features, a.behavior,
               COALESCE(NULLIF(a.title, ''), '練習'), a.description, true
        FROM assignments a
        ON CONFLICT DO NOTHING
        """
        )
    )

    # Step 5: Link assignments back to practices
    op.execute(
        sa.text(
            """
        UPDATE assignments a SET practice_id = p.id
        FROM practices p
        WHERE a.case_id = p.case_id AND a.features = p.features
        """
        )
    )

    # Step 6: Make practice_id NOT NULL and add FK
    op.alter_column("assignments", "practice_id", nullable=False)
    op.create_foreign_key("assignments_practice_id_fkey", "assignments", "practices", ["practice_id"], ["id"])

    # Step 7: Link training_records back to practices
    op.execute(
        sa.text(
            """
        UPDATE training_records tr SET practice_id = a.practice_id
        FROM assignments a
        WHERE tr.assignment_id = a.id AND a.practice_id IS NOT NULL
        """
        )
    )

    # Step 8: Add training_records practice FK
    op.create_foreign_key("fk_training_records_practice_id", "training_records", "practices", ["practice_id"], ["id"])

    # Step 9: Drop new columns from assignments
    op.drop_constraint("fk_assignments_case_id", "assignments", type_="foreignkey")
    op.drop_index("ix_assignments_case", table_name="assignments")
    op.drop_column("assignments", "case_id")
    op.drop_column("assignments", "features")
    op.drop_column("assignments", "behavior")
    op.drop_column("assignments", "student_ids")
