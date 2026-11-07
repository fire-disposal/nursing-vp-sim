"""backfill_personas_from_roles

# Manual override reason: data_only

`role_permissions` 退役前的最后一次性派生：**没有任何 persona 行**的用户，
按「预设权限 ⊆ 角色权限」授予视角（绝不超授；一个都不覆盖就不授予，交管理员处理）。
随后 `role_permissions` 表被 DDL 迁移删除，运行时不再有 legacy 回落。

Revision ID: c1a9e3f7b2d6
Revises: b7e3f9a2c5d4
Create Date: 2026-11-07
"""

from collections.abc import Sequence

from alembic import op

revision: str = "c1a9e3f7b2d6"
down_revision: str | Sequence[str] | None = "b7e3f9a2c5d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_SQL = """
WITH presets(persona, perms) AS (
    VALUES
      ('student', ARRAY['training_access','scenario_training','qa_access']),
      ('teacher', ARRAY['grade_class_manage','case_manage','training_access','scenario_training',
                        'qa_access','score_review','stats_view','assignment_manage',
                        'feedback_review','export_data','questionnaire_manage']),
      ('admin', ARRAY['user_manage','role_manage','grade_class_manage','school_manage','case_manage',
                      'training_access','scenario_training','score_review','stats_view','qa_access',
                      'llm_monitor','assignment_manage','feedback_review','export_data',
                      'questionnaire_manage']),
      ('ops', ARRAY['llm_monitor','api_manage','audit_view','audit_export','feedback_review','export_data'])
)
INSERT INTO user_personas (user_id, persona)
SELECT u.id, p.persona
FROM users u
CROSS JOIN presets p
WHERE NOT EXISTS (SELECT 1 FROM user_personas up WHERE up.user_id = u.id)
  AND NOT EXISTS (
      SELECT 1
      FROM unnest(p.perms) AS perm
      WHERE NOT EXISTS (
          SELECT 1 FROM role_permissions rp
          WHERE rp.role_id = u.role_id AND rp.permission = perm
      )
  )
ON CONFLICT DO NOTHING
"""


def upgrade() -> None:
    op.get_bind().execute(__import__("sqlalchemy").text(_SQL))


def downgrade() -> None:
    # 派生数据不可逆（无法区分本次回填与人工授予）：保留授予行，不删除。
    pass
