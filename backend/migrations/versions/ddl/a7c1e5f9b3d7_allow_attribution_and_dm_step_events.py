"""allow `action_attributed` / `dm_step` event kinds（情境训练 · 动作归属 + DM 多步循环）

同一批的两个新事件种类：

1. `action_attributed`（docs/21 §4.1）：学生改为**自由表达**为主之后，动作在记录里不再天然带
   `affordance_id`。DM 的输出新增 `interpretation.affordance_id`，引擎在写完 `student_action` 之后
   把它的解读**回填**到该回合的动作记录上（判读/白板/维度因此不必各自认词）。回填是一次**状态写入**
   （它改变 `world.actions` 的推导结果），所以照本轨的规矩入事件流：新种类而不是改写旧事件。
2. `dm_step`（docs/21 §四）：DM 的**受限多步循环**的一步（`world.state` / `actor.knowledge` /
   `history.lastN` / `note.write`）。每步都落事件，供教师回放与 `/api/diagnose` 统计；
   学生不可见（`note.write` 只是 DM 的草稿纸）。

`st_events.kind` 的 CHECK 是封闭词表（见 `models/scenario_training.EVENT_KINDS`），
存量库必须同步放宽，否则新事件会被 PG 拒绝。模型与迁移两处保持一致。

Revision ID: a7c1e5f9b3d7
Revises: c8d9e0f1a2b3
Create Date: 2026-09-28
"""

from collections.abc import Sequence

from alembic import op

revision: str = "a7c1e5f9b3d7"
down_revision: str | Sequence[str] | None = "c8d9e0f1a2b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD = (
    "'session_opened', 'student_action', 'dm_turn', 'effects_applied', "
    "'cues_revealed', 'entity_line', 'judge_result', 'session_closed'"
)
_NEW = (
    "'session_opened', 'student_action', 'action_attributed', 'dm_step', 'dm_turn', 'effects_applied', "
    "'cues_revealed', 'entity_line', 'judge_result', 'session_closed'"
)


def _swap(kinds: str) -> None:
    op.drop_constraint("ck_st_events_kind", "st_events", type_="check")
    op.create_check_constraint("ck_st_events_kind", "st_events", f"kind IN ({kinds})")


def upgrade() -> None:
    """Upgrade schema."""
    _swap(_NEW)


def downgrade() -> None:
    """Downgrade schema：先删掉降级后会违反旧词表的行（步骤/归属可丢，动作与叙述不受影响）。"""
    op.execute("DELETE FROM st_events WHERE kind IN ('action_attributed', 'dm_step')")
    _swap(_OLD)
