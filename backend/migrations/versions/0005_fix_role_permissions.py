"""fix role permissions and admin role after rbac migration

- Delete stale permissions from old seed (e.g. teacher_access)
- Insert correct permission set for super_admin, school_admin, teacher, student
- Re-assign admin user(s) from teacher → super_admin
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_PERMS = {
    "super_admin": [
        "user_manage", "role_manage", "grade_class_manage", "case_manage",
        "training_access", "score_review", "stats_view", "qa_access",
        "llm_monitor", "api_manage", "prompt_manage", "feedback_review",
        "export_data", "record_notes", "school_manage",
    ],
    "school_admin": [
        "user_manage", "role_manage", "grade_class_manage", "case_manage",
        "training_access", "score_review", "stats_view", "qa_access",
        "llm_monitor", "feedback_review", "export_data", "record_notes",
    ],
    "teacher": [
        "grade_class_manage", "case_manage", "training_access",
        "score_review", "stats_view", "feedback_review",
        "export_data", "record_notes",
    ],
    "student": [
        "training_access", "qa_access",
    ],
}

_ALL_PERMISSIONS = {p for perms in _PERMS.values() for p in perms}


def upgrade() -> None:
    op.execute("DELETE FROM role_permissions WHERE permission NOT IN ({})".format(
        ",".join(f"'{p}'" for p in sorted(_ALL_PERMISSIONS))
    ))

    for role_name, perms in _PERMS.items():
        values = ",".join(f"('{p}')" for p in perms)
        op.execute(f"""
            INSERT INTO role_permissions (role_id, permission)
            SELECT r.id, p.permission
            FROM roles r
            CROSS JOIN (VALUES {values}) AS p(permission)
            WHERE r.name = '{role_name}'
              AND NOT EXISTS (
                  SELECT 1 FROM role_permissions rp
                  WHERE rp.role_id = r.id AND rp.permission = p.permission
              )
        """)

    op.execute("""
        UPDATE users u
        SET role_id = sa.id
        FROM roles sa
        WHERE sa.name = 'super_admin'
          AND (u.school_id = sa.school_id OR (u.school_id IS NOT NULL AND sa.school_id IS NULL))
          AND u.role_id IN (
              SELECT id FROM roles WHERE name = 'teacher'
          )
    """)


def downgrade() -> None:
    pass
