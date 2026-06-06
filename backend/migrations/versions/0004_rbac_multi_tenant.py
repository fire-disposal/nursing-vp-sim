"""rbac multi-tenant

Revision ID: 0004
Revises: 0003
Create Date: 2025-06-05

Idempotent: all operations check current state before acting.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0004"
down_revision: Union[str, Sequence[str], None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table: str) -> bool:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    return table in insp.get_table_names()


def _has_column(table: str, column: str) -> bool:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    cols = [c["name"] for c in insp.get_columns(table)]
    return column in cols


def _has_constraint(table: str, constraint: str) -> bool:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    fks = [fk["name"] for fk in insp.get_foreign_keys(table)]
    uqs = [uq["name"] for uq in insp.get_unique_constraints(table)]
    pk = insp.get_pk_constraint(table).get("name") or ""
    return constraint in [pk] + fks + uqs


def _safe_add_column(table: str, column) -> None:
    if not _has_column(table, column.name):
        op.add_column(table, column)


def _safe_drop_fk(table: str, constraint: str) -> None:
    if _has_constraint(table, constraint):
        op.drop_constraint(constraint, table, type_="foreignkey")


def _safe_drop_unique(table: str, constraint: str) -> None:
    if _has_constraint(table, constraint):
        op.drop_constraint(constraint, table, type_="unique")


def upgrade() -> None:
    # ── schools ──
    if not _has_table("schools"):
        op.create_table(
            "schools",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("name", sa.String(80), unique=True, nullable=False),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        )

    rows = op.get_bind().execute(sa.text("SELECT COUNT(*) FROM schools")).scalar()
    if rows == 0:
        op.execute("INSERT INTO schools (id, name, created_at) VALUES (1, '默认学校', now())")
        op.execute("SELECT setval(pg_get_serial_sequence('schools', 'id'), COALESCE((SELECT MAX(id) FROM schools), 1))")

    # ── drop pre-existing old-style FKs (from initial schema with role VARCHAR) ──
    _safe_drop_fk("role_permissions", "role_permissions_role_name_fkey")
    _safe_drop_fk("users", "users_role_fkey")

    # ── roles: migrate from (name PK) to (id PK + school_id FK) ──
    has_id = _has_column("roles", "id")
    has_id_new = _has_column("roles", "id_new")

    _safe_add_column("roles", sa.Column("id_new", sa.Integer(), autoincrement=True, nullable=True))
    _safe_add_column("roles", sa.Column("school_id", sa.Integer(), nullable=True))

    if not has_id:
        # Original path: roles uses name as PK, no id column
        op.execute("""
            UPDATE roles r
            SET id_new = seq.rn
            FROM (SELECT name, row_number() OVER (ORDER BY name) AS rn FROM roles) AS seq
            WHERE r.name = seq.name
        """)
        op.execute("UPDATE roles SET school_id = NULL")

        if _has_constraint("roles", "roles_pkey"):
            op.execute("ALTER TABLE roles DROP CONSTRAINT roles_pkey CASCADE")
        op.create_primary_key("roles_pkey", "roles", ["id_new"])

        op.alter_column("roles", "id_new", new_column_name="id", nullable=False)
    else:
        # Already has id column (from Base.metadata.create_all in 0001)
        # Drop the redundant id_new column
        if has_id_new:
            op.drop_column("roles", "id_new")
        op.execute("UPDATE roles SET school_id = NULL WHERE school_id IS NULL")

    op.create_unique_constraint("uq_roles_school_name", "roles", ["school_id", "name"])
    if not _has_constraint("roles", "fk_roles_school"):
        op.create_foreign_key("fk_roles_school", "roles", "schools", ["school_id"], ["id"], ondelete="CASCADE")

    # ── role_permissions: migrate from role_name to role_id ──
    if _has_column("role_permissions", "role_name"):
        _safe_add_column("role_permissions", sa.Column("role_id_new", sa.Integer(), nullable=True))

        op.execute("""
            UPDATE role_permissions rp
            SET role_id_new = r.id
            FROM roles r
            WHERE rp.role_name = r.name
        """)

        _safe_drop_unique("role_permissions", "ix_rp_role_perm")
        op.drop_column("role_permissions", "role_name")
        op.alter_column("role_permissions", "role_id_new", new_column_name="role_id", nullable=False)
    else:
        # Already has role_id (from Base.metadata.create_all in 0001)
        pass

    if not _has_constraint("role_permissions", "fk_rp_role"):
        op.create_foreign_key("fk_rp_role", "role_permissions", "roles", ["role_id"], ["id"], ondelete="CASCADE")
    if not _has_constraint("role_permissions", "ix_rp_role_perm"):
        op.create_unique_constraint("ix_rp_role_perm", "role_permissions", ["role_id", "permission"])

    # ── users: migrate from role VARCHAR to role_id INTEGER FK ──
    if _has_column("users", "role"):
        _safe_add_column("users", sa.Column("school_id_new", sa.Integer(), nullable=True))
        _safe_add_column("users", sa.Column("role_id_new", sa.Integer(), nullable=True))

        op.execute("UPDATE users SET school_id_new = 1")
        op.execute("""
            UPDATE users u
            SET role_id_new = r.id
            FROM roles r
            WHERE u.role = r.name
        """)
        op.drop_column("users", "role")
        op.alter_column("users", "school_id_new", new_column_name="school_id", nullable=False)
        op.alter_column("users", "role_id_new", new_column_name="role_id", nullable=False)
    else:
        # Already has role_id (from Base.metadata.create_all in 0001)
        op.execute("UPDATE users SET school_id = 1 WHERE school_id IS NULL")

    if not _has_constraint("users", "fk_users_role"):
        op.create_foreign_key("fk_users_role", "users", "roles", ["role_id"], ["id"], ondelete="RESTRICT")
    if not _has_constraint("users", "fk_users_school"):
        op.create_foreign_key("fk_users_school", "users", "schools", ["school_id"], ["id"], ondelete="RESTRICT")

    # ── grades: add school_id ──
    _safe_drop_unique("grades", "grades_name_key")
    if not _has_column("grades", "school_id"):
        _safe_add_column("grades", sa.Column("school_id_new", sa.Integer(), nullable=True))
        op.execute("UPDATE grades SET school_id_new = 1")
        op.alter_column("grades", "school_id_new", new_column_name="school_id", nullable=False)
    else:
        op.execute("UPDATE grades SET school_id = 1 WHERE school_id IS NULL")

    if not _has_constraint("grades", "fk_grades_school"):
        op.create_foreign_key("fk_grades_school", "grades", "schools", ["school_id"], ["id"], ondelete="CASCADE")
    op.create_unique_constraint("uq_grades_school_name", "grades", ["school_id", "name"])

    # ── cases: add school_id ──
    _safe_add_column("cases", sa.Column("school_id", sa.Integer(), nullable=True))
    if not _has_constraint("cases", "fk_cases_school"):
        op.create_foreign_key("fk_cases_school", "cases", "schools", ["school_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    _safe_drop_fk("cases", "fk_cases_school")
    if _has_column("cases", "school_id"):
        op.drop_column("cases", "school_id")

    _safe_drop_unique("grades", "uq_grades_school_name")
    _safe_drop_fk("grades", "fk_grades_school")
    if _has_column("grades", "school_id"):
        op.drop_column("grades", "school_id")
    op.create_unique_constraint("grades_name_key", "grades", ["name"])

    _safe_drop_fk("users", "fk_users_role")
    _safe_drop_fk("users", "fk_users_school")
    _safe_drop_fk("role_permissions", "fk_rp_role")
    _safe_drop_unique("role_permissions", "ix_rp_role_perm")

    _safe_add_column("users", sa.Column("role", sa.String(20), nullable=True))
    op.execute("""
        UPDATE users u
        SET role = r.name
        FROM roles r
        WHERE u.role_id = r.id
    """)
    if _has_column("users", "school_id"):
        op.drop_column("users", "school_id")
    if _has_column("users", "role_id"):
        op.drop_column("users", "role_id")

    _safe_add_column("role_permissions", sa.Column("role_name", sa.String(20), nullable=True))
    op.execute("""
        UPDATE role_permissions rp
        SET role_name = r.name
        FROM roles r
        WHERE rp.role_id = r.id
    """)
    if _has_column("role_permissions", "role_id"):
        op.drop_column("role_permissions", "role_id")

    _safe_drop_fk("roles", "fk_roles_school")
    _safe_drop_unique("roles", "uq_roles_school_name")
    if _has_constraint("roles", "roles_pkey"):
        op.execute("ALTER TABLE roles DROP CONSTRAINT roles_pkey CASCADE")
    if _has_column("roles", "id"):
        op.drop_column("roles", "id")
    op.create_primary_key("roles_pkey", "roles", ["name"])
    if _has_column("roles", "school_id"):
        op.drop_column("roles", "school_id")

    op.create_foreign_key("role_permissions_role_name_fkey", "role_permissions", "roles", ["role_name"], ["name"], ondelete="CASCADE")
    op.create_unique_constraint("ix_rp_role_perm", "role_permissions", ["role_name", "permission"])
    op.create_foreign_key("users_role_fkey", "users", "roles", ["role"], ["name"], ondelete="RESTRICT")

    op.drop_table("schools")
