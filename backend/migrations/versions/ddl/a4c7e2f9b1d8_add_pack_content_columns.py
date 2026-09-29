"""病例内容并入 st_packs / 会话快照：**加列**（结构，无数据操作）

三枚一套（`ddl → data → ddl`），因为仓库规矩是"结构在 ddl、数据操作在 data"：
- `a4c7e2f9b1d8`（本枚）：加 `st_packs.content`/`version`、`st_sessions.pack_content`/`pack_version`；
- `b5d8f3a2c6e9`（data）：把内容与快照搬过来；
- `c6e9a4b3d7f1`（ddl）：删掉修订表/归档表/`state`/`title`/`one_line`/`pack_revision_id`。

Revision ID: a4c7e2f9b1d8
Revises: e3b8f1a6c2d9
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql

revision: str = "a4c7e2f9b1d8"
down_revision: str | Sequence[str] | None = "e3b8f1a6c2d9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_JSONB = postgresql.JSONB(astext_type=sa.Text())


def _columns(table: str) -> set[str]:
    insp = inspect(op.get_bind())
    if table not in insp.get_table_names():
        return set()
    return {column["name"] for column in insp.get_columns(table)}


def upgrade() -> None:
    """Upgrade schema."""
    pack_columns = _columns("st_packs")
    if "content" not in pack_columns:
        op.add_column("st_packs", sa.Column("content", _JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")))
    if "version" not in pack_columns:
        op.add_column("st_packs", sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("1")))

    session_columns = _columns("st_sessions")
    if "pack_content" not in session_columns:
        op.add_column(
            "st_sessions", sa.Column("pack_content", _JSONB, nullable=False, server_default=sa.text("'{}'::jsonb"))
        )
    if "pack_version" not in session_columns:
        op.add_column("st_sessions", sa.Column("pack_version", sa.Integer(), nullable=False, server_default=sa.text("0")))


def downgrade() -> None:
    """Downgrade schema：把本枚加的列删掉（内容随之丢失，见 data 迁移的说明）。"""
    for column in ("pack_version", "pack_content"):
        if column in _columns("st_sessions"):
            op.drop_column("st_sessions", column)
    for column in ("version", "content"):
        if column in _columns("st_packs"):
            op.drop_column("st_packs", column)
