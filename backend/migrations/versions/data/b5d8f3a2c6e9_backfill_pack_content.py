"""把病例内容与"会话当时那份"搬进新列（纯数据搬运）

本枚只做 `UPDATE`，不碰结构：
1. 每包取**最新修订**写入 `st_packs.content`，并把修订号写进 `st_packs.version`；
2. 每个会话按它 `pack_revision_id` 把当时那份内容抄进 `pack_content`（+ `pack_version`）——
   这就是"可复现性靠会话自带"的来源，之后删修订表不影响旧局；
3. `title` / `one_line` 两列的值并入 `content`（内容里已有该键则以内容为准）。

幂等：重复执行结果一致。`downgrade` 是 no-op——内容不回滚（删修订表后也回滚不了），
结构回退由 `a4c7e2f9b1d8` / `c6e9a4b3d7f1` 负责。

Manual override reason: data_only

Revision ID: b5d8f3a2c6e9
Revises: a4c7e2f9b1d8
"""

from collections.abc import Sequence

from alembic import op
from sqlalchemy import inspect

revision: str = "b5d8f3a2c6e9"
down_revision: str | Sequence[str] | None = "a4c7e2f9b1d8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    """Upgrade data."""
    tables = _tables()

    if "st_pack_revisions" in tables:
        op.execute(
            """
            UPDATE st_packs AS p
               SET content = r.content,
                   version = r.revision_no
              FROM (
                    SELECT DISTINCT ON (pack_id) pack_id, content, revision_no
                      FROM st_pack_revisions
                     ORDER BY pack_id, revision_no DESC
                   ) AS r
             WHERE r.pack_id = p.id
            """
        )

        op.execute(
            """
            UPDATE st_sessions AS s
               SET pack_content = r.content,
                   pack_version = r.revision_no
              FROM st_pack_revisions AS r
             WHERE r.id = s.pack_revision_id
            """
        )

    # 展示字段并入内容（内容里已有 title/one_line 时以内容为准）
    op.execute(
        """
        UPDATE st_packs
           SET content = content
                      || CASE WHEN content ? 'title' THEN '{}'::jsonb ELSE jsonb_build_object('title', title) END
                      || CASE WHEN content ? 'one_line' THEN '{}'::jsonb ELSE jsonb_build_object('one_line', one_line) END
         WHERE title IS NOT NULL OR one_line IS NOT NULL
        """
    )


def downgrade() -> None:
    """Downgrade data：把 `title`/`one_line` 两列的值从内容取回（结构由 ddl 迁移重建）。

    内容本身不回滚（删修订表后也回滚不了）；这里只保证"列与内容一致"，
    让降级后的旧代码读到的标题仍是作者写的那一个。
    """
    insp = inspect(op.get_bind())
    if "st_packs" not in insp.get_table_names():
        return
    columns = {column["name"] for column in insp.get_columns("st_packs")}
    if {"title", "one_line", "content"} <= columns:
        op.execute(
            """
            UPDATE st_packs
               SET title = coalesce(content ->> 'title', ''),
                   one_line = coalesce(content ->> 'one_line', '')
            """
        )
