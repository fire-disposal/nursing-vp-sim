"""resync_system_role_permissions

# Manual override reason: data_only

将已部署环境中 4 个系统角色的 role_permissions 重新同步到当前定义
（core/roles.py）。因 seed 仅在空库首次写权限，此迁移用于让存量
staging/prod 生效。对空库（含 pre-push roundtrip 临时库）为无操作。

本次实际变更：teacher 增补 qa_access。

Revision ID: mreipemggvlq
Revises: 449911a0d604
Create Date: 2026-07-10 05:51:18

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "mreipemggvlq"
down_revision: Union[str, Sequence[str], None] = "449911a0d604"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# 目标状态（与 core/roles.py 同步）
_NEW: dict[str, list[str]] = {
    "super_admin": [
        "user_manage",
        "role_manage",
        "grade_class_manage",
        "case_manage",
        "training_access",
        "score_review",
        "stats_view",
        "qa_access",
        "llm_monitor",
        "api_manage",
        "assignment_manage",
        "feedback_review",
        "export_data",
        "record_notes",
        "questionnaire_manage",
    ],
    "school_admin": [
        "user_manage",
        "role_manage",
        "grade_class_manage",
        "case_manage",
        "training_access",
        "score_review",
        "stats_view",
        "qa_access",
        "llm_monitor",
        "assignment_manage",
        "feedback_review",
        "export_data",
        "record_notes",
        "questionnaire_manage",
    ],
    "teacher": [
        "grade_class_manage",
        "case_manage",
        "training_access",
        "qa_access",
        "score_review",
        "stats_view",
        "assignment_manage",
        "feedback_review",
        "export_data",
        "record_notes",
        "questionnaire_manage",
    ],
    "student": [
        "training_access",
        "qa_access",
    ],
}

# 变更前状态（唯一差异：teacher 无 qa_access）
_OLD: dict[str, list[str]] = {
    **_NEW,
    "teacher": [p for p in _NEW["teacher"] if p != "qa_access"],
}


def _resync(role_perms: dict[str, list[str]]) -> None:
    bind = op.get_bind()
    for name, perms in role_perms.items():
        bind.execute(
            sa.text(
                "DELETE FROM role_permissions WHERE role_id IN "
                "(SELECT id FROM roles WHERE name = :n AND is_system = true)"
            ),
            {"n": name},
        )
        for perm in perms:
            bind.execute(
                sa.text(
                    "INSERT INTO role_permissions (role_id, permission) "
                    "SELECT id, :p FROM roles WHERE name = :n AND is_system = true"
                ),
                {"n": name, "p": perm},
            )


def upgrade() -> None:
    """Upgrade schema."""
    _resync(_NEW)


def downgrade() -> None:
    """Downgrade schema."""
    _resync(_OLD)
