"""backfill_personas_from_role_names

# Manual override reason: data_only

丢弃 `users.role_id` / `roles` 之前的最后兜底：
- `super_admin` 角色的账号标为平台账号（`is_platform`）；
- 仍无任何 persona 的 student/teacher/admin 账号按角色名补一个同名视角。

幂等；不覆盖已有授予。

Revision ID: d9f2a6c4e8b1
Revises: d2b8f4a1c6e9
Create Date: 2026-11-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d9f2a6c4e8b1"
down_revision: str | Sequence[str] | None = "d2b8f4a1c6e9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_MAP_SQL = """
UPDATE users u
SET is_platform = true
FROM roles r
WHERE r.id = u.role_id AND r.name = 'super_admin' AND u.is_platform = false
"""

_GRANT_SQL = """
INSERT INTO user_personas (user_id, persona)
SELECT u.id, r.name
FROM users u
JOIN roles r ON r.id = u.role_id
WHERE r.name IN ('student', 'teacher', 'admin')
  AND NOT EXISTS (SELECT 1 FROM user_personas up WHERE up.user_id = u.id)
ON CONFLICT DO NOTHING
"""


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text(_MAP_SQL))
    bind.execute(sa.text(_GRANT_SQL))


def downgrade() -> None:
    # 派生数据不可逆，保留授予行
    pass
