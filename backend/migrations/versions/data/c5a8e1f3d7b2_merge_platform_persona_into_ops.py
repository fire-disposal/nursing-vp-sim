"""merge platform persona grants into ops

`platform` 视角并入 `ops`：代码里不再有 `platform` 预设，跨院校管理能力（院校管理、
密钥、审计、成本、诊断）由 `ops` 一档承担。这里把库里现存的 `(user, school)` 授予
从 `platform` 迁到 `ops`。

`users.is_platform`（账号身份）与 `PersonaScope.platform`（数据作用域）不动 ——
本迁移只涉及 `user_school_personas.persona` 的取值。

可逆：被改动的行（原 platform 授予）记进辅助表 ``persona_platform_merge_log``。
- 同一 ``(user_id, school_id)`` 已另有 ``ops`` 行时，该 platform 行被**删除**（去重），
  辅助表记 ``merged_into_existing = true``；
- 否则原地 ``UPDATE`` 成 ``ops``，记 ``merged_into_existing = false``。
downgrade 按辅助表精确还原：把本次改成的 ops 行改回 platform、把被删除的 platform 行
插回，从而**只**回退由 platform 来的行，不会把用户原本就有的 ops 授予错回成 platform。

# Manual override reason: data_only

Revision ID: c5a8e1f3d7b2
Revises: b7e3c5a9d1f8
Create Date: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "c5a8e1f3d7b2"
down_revision: str | Sequence[str] | None = "b7e3c5a9d1f8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_GRANTS = "user_school_personas"
_LOG = "persona_platform_merge_log"

_grants = sa.table(
    _GRANTS,
    sa.column("user_id", sa.Integer()),
    sa.column("school_id", sa.Integer()),
    sa.column("persona", sa.String(20)),
)
_grants_dst = _grants.alias("dst")
_log = sa.table(
    _LOG,
    sa.column("user_id", sa.Integer()),
    sa.column("school_id", sa.Integer()),
    sa.column("merged_into_existing", sa.Boolean()),
)


def _ensure_log_table() -> None:
    if inspect(op.get_bind()).has_table(_LOG):
        return
    op.create_table(
        _LOG,
        sa.Column("user_id", sa.Integer(), primary_key=True),
        sa.Column(
            "school_id",
            sa.Integer(),
            sa.ForeignKey("schools.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        # True = 该行已被同校 ops 覆盖而删除；False = 该行被原地 UPDATE 成 ops。
        sa.Column("merged_into_existing", sa.Boolean(), nullable=False),
    )


def upgrade() -> None:
    bind = op.get_bind()
    _ensure_log_table()

    # 1) 同 (user, school) 已有 ops 的 platform 行：新 ops = 旧 ops ∪ 旧 platform，
    #    删掉重复行不损失权限。先记档再删，downgrade 才能精确插回。
    covered_by_ops = (
        sa.select(_grants.c.user_id, _grants.c.school_id)
        .where(
            _grants.c.persona == "platform",
            sa.exists().where(
                _grants_dst.c.user_id == _grants.c.user_id,
                _grants_dst.c.school_id == _grants.c.school_id,
                _grants_dst.c.persona == "ops",
            ),
        )
        .distinct()
    )
    duplicates = bind.execute(covered_by_ops).all()
    if duplicates:
        bind.execute(
            sa.insert(_log),
            [{"user_id": r.user_id, "school_id": r.school_id, "merged_into_existing": True} for r in duplicates],
        )
        bind.execute(
            sa.delete(_grants).where(
                _grants.c.persona == "platform",
                sa.tuple_(_grants.c.user_id, _grants.c.school_id).in_([(r.user_id, r.school_id) for r in duplicates]),
            )
        )

    # 2) 其余 platform 行：原地改成 ops。先记档，downgrade 才知道哪些 ops 行来自 platform。
    merged = bind.execute(
        sa.select(_grants.c.user_id, _grants.c.school_id).where(_grants.c.persona == "platform")
    ).all()
    if merged:
        bind.execute(
            sa.insert(_log),
            [{"user_id": r.user_id, "school_id": r.school_id, "merged_into_existing": False} for r in merged],
        )
        bind.execute(sa.update(_grants).where(_grants.c.persona == "platform").values(persona="ops"))


def downgrade() -> None:
    """按辅助表精确回退：只还原由 platform 来的行，原有 ops 行原样不动。"""
    bind = op.get_bind()
    if not inspect(bind).has_table(_LOG):
        # 没有证据就没有回退依据：宁可不改，也不把用户的 ops 授予批量错回成 platform。
        return

    rows = bind.execute(sa.select(_log.c.user_id, _log.c.school_id, _log.c.merged_into_existing)).all()
    restored = [(r.user_id, r.school_id) for r in rows if not r.merged_into_existing]
    deleted = [(r.user_id, r.school_id) for r in rows if r.merged_into_existing]

    if restored:
        bind.execute(
            sa.update(_grants)
            .where(
                _grants.c.persona == "ops",
                sa.tuple_(_grants.c.user_id, _grants.c.school_id).in_(restored),
            )
            .values(persona="platform")
        )
    if deleted:
        bind.execute(
            sa.insert(_grants),
            [{"user_id": uid, "school_id": sid, "persona": "platform"} for uid, sid in deleted],
        )
    op.drop_table(_LOG)
