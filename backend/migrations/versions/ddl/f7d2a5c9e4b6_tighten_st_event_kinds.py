"""把 `st_events.kind` 的写集收紧到当前的 5 种（旧机制种类退出历史）。

**前置条件（必须由数据清理先满足）**：库里不能再有旧种类的行
（`student_action` / `action_attributed` / `dm_step` / `dm_turn` / `anchor_*` /
`effects_applied` / `cues_revealed` / `entity_line` / `judge_result`）。
迁移**不替操作者删数据**：若还有旧行，PG 会在 `ADD CONSTRAINT` 处直接拒绝
（`ck_st_events_kind ... is violated by some row`），整条迁移回滚——这是刻意的 fail-closed。
旧会话的回看走归档投影（`st_session_archives`），不再重放旧种类事件。

`downgrade` 是**放宽**（把 11 种旧种类加回词表），任何时候都能安全执行。

Revision ID: f7d2a5c9e4b6
Revises: d5b9e3a7c2f4
Create Date: 2026-09-29
"""

from collections.abc import Sequence

from alembic import op

revision: str = "f7d2a5c9e4b6"
down_revision: str | Sequence[str] | None = "d5b9e3a7c2f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: 当前唯一会写入的 5 种（`models/scenario_training.py::EVENT_KINDS`）
_CURRENT = "'session_opened', 'turn_committed', 'clarification_exchange', 'hint_requested', 'session_closed'"

#: 收紧前（b3f7a1c9d2e4 建立的语义超集）——只在 downgrade 里用，保证可逆
_WIDENED = (
    "'session_opened', 'turn_committed', 'clarification_exchange', 'hint_requested', 'session_closed', "
    "'student_action', 'action_attributed', 'dm_step', 'dm_turn', "
    "'anchor_satisfied', 'anchor_blocked', 'anchor_proposal_rejected', "
    "'effects_applied', 'cues_revealed', 'entity_line', 'judge_result'"
)


def _swap(kinds: str) -> None:
    op.drop_constraint("ck_st_events_kind", "st_events", type_="check")
    op.create_check_constraint("ck_st_events_kind", "st_events", f"kind IN ({kinds})")


def upgrade() -> None:
    """Upgrade schema: 词表收紧到 5 种（有旧行时报错并回滚，不删数据）。"""
    _swap(_CURRENT)


def downgrade() -> None:
    """Downgrade schema: 放宽回 16 种（只放宽，不会因既有行失败）。"""
    _swap(_WIDENED)
