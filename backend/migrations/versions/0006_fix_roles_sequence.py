"""fix roles.id sequence and add training_records.time_limit

- migration 0004 added id_new via ALTER TABLE ADD COLUMN, which does not
  auto-create a SERIAL sequence in PostgreSQL.  create the missing sequence.
- training_records.time_limit column exists in model but was never added to DB.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE SEQUENCE IF NOT EXISTS roles_id_seq OWNED BY roles.id")
    op.execute("ALTER TABLE roles ALTER COLUMN id SET DEFAULT nextval('roles_id_seq')")
    op.execute("SELECT setval('roles_id_seq', (SELECT COALESCE(MAX(id), 0) FROM roles))")

    conn = op.get_bind()
    insp = sa.inspect(conn)
    cols = [c["name"] for c in insp.get_columns("training_records")]
    if "time_limit" not in cols:
        op.add_column("training_records", sa.Column("time_limit", sa.Integer(), nullable=False, server_default="20"))


def downgrade() -> None:
    op.execute("ALTER TABLE roles ALTER COLUMN id DROP DEFAULT")
    op.execute("DROP SEQUENCE IF EXISTS roles_id_seq")

    conn = op.get_bind()
    insp = sa.inspect(conn)
    cols = [c["name"] for c in insp.get_columns("training_records")]
    if "time_limit" in cols:
        op.drop_column("training_records", "time_limit")
