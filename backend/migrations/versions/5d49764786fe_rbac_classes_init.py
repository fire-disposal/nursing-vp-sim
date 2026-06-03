"""rbac_classes_init

Revision ID: 5d49764786fe
Revises: 6c6110223b55
Create Date: 2026-06-02 10:06:39.925736
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '5d49764786fe'
down_revision: Union[str, Sequence[str], None] = '6c6110223b55'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(table_name: str) -> bool:
    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_name=:name AND table_schema=current_schema()"
    ), {"name": table_name}).fetchall()
    return len(rows) > 0


def _index_exists(table_name: str, index_name: str) -> bool:
    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT indexname FROM pg_indexes "
        "WHERE tablename=:tbl AND indexname=:idx AND schemaname=current_schema()"
    ), {"tbl": table_name, "idx": index_name}).fetchall()
    return len(rows) > 0


def _fk_exists(table_name: str, fk_name: str) -> bool:
    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT conname FROM pg_constraint "
        "WHERE conrelid=CAST(:tbl AS regclass) AND contype='f' AND conname=:name"
    ), {"tbl": table_name, "name": fk_name}).fetchall()
    return len(rows) > 0


def upgrade() -> None:
    # 1. Create roles table
    if not _table_exists("roles"):
        op.create_table("roles",
            sa.Column("name", sa.String(20), nullable=False),
            sa.Column("display_name", sa.String(40), nullable=False),
            sa.Column("is_system", sa.Boolean(), nullable=False, server_default="false"),
            sa.PrimaryKeyConstraint("name"),
        )

    # 2. Create role_permissions table
    if not _table_exists("role_permissions"):
        op.create_table("role_permissions",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("role_name", sa.String(20), sa.ForeignKey("roles.name", ondelete="CASCADE"), nullable=False),
            sa.Column("permission", sa.String(40), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        if not _index_exists("role_permissions", "ix_rp_role_perm"):
            op.create_index("ix_rp_role_perm", "role_permissions", ["role_name", "permission"], unique=True)

    # 3. Create grades table
    if not _table_exists("grades"):
        op.create_table("grades",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(40), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("name"),
        )

    # 4. Create classes table
    if not _table_exists("classes"):
        op.create_table("classes",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("grade_id", sa.Integer(), sa.ForeignKey("grades.id", ondelete="CASCADE"), nullable=False),
            sa.Column("name", sa.String(60), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("grade_id", "name"),
        )
        if not _index_exists("classes", "ix_classes_grade_id"):
            op.create_index("ix_classes_grade_id", "classes", ["grade_id"])

    # 5. Create user_class table
    if not _table_exists("user_class"):
        op.create_table("user_class",
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("class_id", sa.Integer(), sa.ForeignKey("classes.id", ondelete="SET NULL"), nullable=True),
            sa.Column("joined_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("user_id"),
        )
        if not _index_exists("user_class", "ix_user_class_class_id"):
            op.create_index("ix_user_class_class_id", "user_class", ["class_id"])

    # 6. Seed: Insert roles and permissions (MUST be before FK on users.role)
    op.execute(
        "INSERT INTO roles (name, display_name, is_system) VALUES "
        "('teacher', '\u6559\u5e08', true), "
        "('student', '\u5b66\u751f', true) "
        "ON CONFLICT (name) DO NOTHING"
    )

    teacher_perms = [
        "teacher_access", "user_manage", "case_manage", "score_review",
        "llm_monitor", "api_manage", "prompt_manage",
        "grade_class_manage",
    ]
    student_perms = ["training_access", "qa_access"]

    for perm in teacher_perms:
        op.execute(sa.text(
            "INSERT INTO role_permissions (role_name, permission) VALUES ('teacher', :p) ON CONFLICT DO NOTHING"
        ).bindparams(p=perm))

    for perm in student_perms:
        op.execute(sa.text(
            "INSERT INTO role_permissions (role_name, permission) VALUES ('student', :p) ON CONFLICT DO NOTHING"
        ).bindparams(p=perm))

    # 7. Alter users.role: String(10)->String(20) + FK->roles.name
    conn = op.get_bind()
    if _fk_exists("users", "fk_users_role"):
        op.drop_constraint("fk_users_role", "users", type_="foreignkey")

    col_info = conn.execute(sa.text(
        "SELECT data_type, character_maximum_length FROM information_schema.columns "
        "WHERE table_name='users' AND column_name='role' AND table_schema=current_schema()"
    )).fetchone()
    col_type = col_info[0] if col_info else None
    col_len = col_info[1] if col_info else None
    if col_type != 'character varying' or col_len != 20:
        op.alter_column("users", "role",
            existing_type=sa.String(10),
            type_=sa.String(20),
            existing_nullable=False,
            existing_server_default=None,
        )

    if not _fk_exists("users", "fk_users_role"):
        op.create_foreign_key(
            "fk_users_role", "users", "roles",
            ["role"], ["name"],
            ondelete="RESTRICT",
        )


def downgrade() -> None:
    op.drop_constraint("fk_users_role", "users", type_="foreignkey")
    op.alter_column("users", "role",
        existing_type=sa.String(20),
        type_=sa.String(10),
        existing_nullable=False,
        existing_server_default=None,
    )
    op.execute("DELETE FROM role_permissions")
    op.execute("DELETE FROM roles")
    op.drop_index("ix_user_class_class_id", table_name="user_class")
    op.drop_table("user_class")
    op.drop_index("ix_classes_grade_id", table_name="classes")
    op.drop_table("classes")
    op.drop_table("grades")
    op.drop_index("ix_rp_role_perm", table_name="role_permissions")
    op.drop_table("role_permissions")
    op.drop_table("roles")
