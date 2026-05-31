"""qa_multiturn

Revision ID: 7e4d9538330c
Revises: fb86a23a8928
Create Date: 2026-06-01 00:45:10.085037

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7e4d9538330c'
down_revision: Union[str, Sequence[str], None] = 'fb86a23a8928'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # 1. Create qa_sessions table
    op.create_table("qa_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(80), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_qa_sessions_user_updated", "qa_sessions", ["user_id", "updated_at"])

    # 2. Add new columns to qa_records (nullable initially)
    op.add_column("qa_records", sa.Column("session_id", sa.Integer(), sa.ForeignKey("qa_sessions.id"), nullable=True))
    op.add_column("qa_records", sa.Column("role", sa.String(20), nullable=True))
    op.add_column("qa_records", sa.Column("content", sa.Text(), nullable=True))
    op.create_index("ix_qa_session_created", "qa_records", ["session_id", "created_at"])

    # 3. Make old question/answer columns nullable for data migration
    with op.batch_alter_table("qa_records") as batch_op:
        batch_op.alter_column("question", nullable=True)
        batch_op.alter_column("answer", nullable=True)

    # 4. Data migration: each old qa_records row → 1 session + 2 rows
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, user_id, question, answer, created_at FROM qa_records ORDER BY id")).fetchall()

    for r in rows:
        title = (r.question or "")[:40]
        conn.execute(sa.text("INSERT INTO qa_sessions (user_id, title, created_at, updated_at) VALUES (:uid, :title, :ts, :ts)"),
                     {"uid": r.user_id, "title": title, "ts": r.created_at})

        if hasattr(conn, 'dialect') and conn.dialect.name == 'sqlite':
            sid = conn.execute(sa.text("SELECT last_insert_rowid()")).scalar()
        else:
            sid = conn.execute(sa.text("SELECT currval('qa_sessions_id_seq')")).scalar()

        conn.execute(sa.text("UPDATE qa_records SET session_id = :sid, role = 'user', content = question WHERE id = :rid"),
                     {"sid": sid, "rid": r.id})
        conn.execute(sa.text("INSERT INTO qa_records (session_id, user_id, role, content, created_at) VALUES (:sid, :uid, 'assistant', :ans, :ts)"),
                     {"sid": sid, "uid": r.user_id, "ans": r.answer or "", "ts": r.created_at})

    conn.commit()

    # 5. Set NOT NULL on new columns
    with op.batch_alter_table("qa_records") as batch_op:
        batch_op.alter_column("session_id", nullable=False)
        batch_op.alter_column("role", nullable=False)
        batch_op.alter_column("content", nullable=False)

    # 6. Drop old columns
    with op.batch_alter_table("qa_records") as batch_op:
        batch_op.drop_column("question")
        batch_op.drop_column("answer")


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("qa_records") as batch_op:
        batch_op.add_column(sa.Column("question", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("answer", sa.Text(), nullable=True))

    conn = op.get_bind()
    sessions = conn.execute(sa.text("SELECT id FROM qa_sessions")).fetchall()
    for s in sessions:
        user_msg = conn.execute(sa.text("SELECT id, content FROM qa_records WHERE session_id = :sid AND role = 'user' ORDER BY created_at LIMIT 1"), {"sid": s[0]}).fetchone()
        assistant_msg = conn.execute(sa.text("SELECT id, content FROM qa_records WHERE session_id = :sid AND role = 'assistant' ORDER BY created_at DESC LIMIT 1"), {"sid": s[0]}).fetchone()
        if user_msg:
            conn.execute(sa.text("UPDATE qa_records SET question = :q, answer = :a WHERE id = :rid"),
                         {"q": user_msg[1], "a": assistant_msg[1] if assistant_msg else "", "rid": user_msg[0]})
        if assistant_msg and user_msg and assistant_msg[0] != user_msg[0]:
            conn.execute(sa.text("DELETE FROM qa_records WHERE id = :rid"), {"rid": assistant_msg[0]})
    conn.commit()

    op.drop_index("ix_qa_session_created", table_name="qa_records")
    with op.batch_alter_table("qa_records") as batch_op:
        batch_op.drop_column("content")
        batch_op.drop_column("role")
        batch_op.drop_column("session_id")
    op.drop_index("ix_qa_sessions_user_updated", table_name="qa_sessions")
    op.drop_table("qa_sessions")
