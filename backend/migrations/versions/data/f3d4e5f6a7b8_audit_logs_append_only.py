"""audit_logs_append_only

# Manual override reason: data_only

给 `audit_logs` 装 DB 级 append-only 守卫：UPDATE / DELETE 直接抛错。

为什么必须有这一层（2026-09-26 审计研究 §3.1）：应用层"只暴露 record()"挡不住直连数据库、
ORM 误用或未来的运维脚本；审计表若可被静默改写，前面所有留痕都失去意义。
（受限角色方案（REVOKE UPDATE/DELETE）需要改连接凭据，风险更大，留待 A6 后续。）

Revision ID: f3d4e5f6a7b8
Revises: f2c3d4e5f6a7
Create Date: 2026-09-26

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f3d4e5f6a7b8"
down_revision: str | Sequence[str] | None = "f2c3d4e5f6a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            CREATE OR REPLACE FUNCTION audit_logs_forbid_mutation() RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION 'audit_logs 是只追加表：禁止 UPDATE / DELETE（审计证据不可改写）';
            END;
            $$ LANGUAGE plpgsql;
            """
        )
    )
    bind.execute(
        sa.text(
            """
            CREATE TRIGGER trg_audit_logs_append_only
            BEFORE UPDATE OR DELETE ON audit_logs
            FOR EACH ROW EXECUTE FUNCTION audit_logs_forbid_mutation();
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON audit_logs"))
    bind.execute(sa.text("DROP FUNCTION IF EXISTS audit_logs_forbid_mutation()"))
