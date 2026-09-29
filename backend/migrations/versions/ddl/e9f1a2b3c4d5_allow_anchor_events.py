"""allow `anchor_satisfied` / `anchor_blocked` / `anchor_proposal_rejected` event kinds
（情境训练 · 叙事锚点，docs/scenario.md）

同一批的三个新事件种类：

1. `anchor_satisfied` / `anchor_blocked`：DM 在信封里**提议**某个锚点已达成 / 被卡住，
   引擎按「只采纳与重算一致者」裁决通过后记一条（状态本身仍是**事件流 × 声明**的函数，
   这两个事件是回放/教师侧的过程证据，不是新的真源）。
2. `anchor_proposal_rejected`：提案与引擎重算不一致 → 整条丢弃（`todo` 口径），
   并留一条事件；下回合的提示词据此注入纠偏提醒。

`st_events.kind` 的 CHECK 是封闭词表（见 `models/scenario_training.EVENT_KINDS`），
存量库必须同步放宽，否则新事件会被 PG 拒绝。模型与迁移两处保持一致。

Revision ID: e9f1a2b3c4d5
Revises: a7c1e5f9b3d7
Create Date: 2026-09-28
"""

from collections.abc import Sequence

from alembic import op

revision: str = "e9f1a2b3c4d5"
down_revision: str | Sequence[str] | None = "a7c1e5f9b3d7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD = (
    "'session_opened', 'student_action', 'action_attributed', 'dm_step', 'dm_turn', 'effects_applied', "
    "'cues_revealed', 'entity_line', 'judge_result', 'session_closed'"
)
_NEW = (
    "'session_opened', 'student_action', 'action_attributed', 'dm_step', 'dm_turn', "
    "'anchor_satisfied', 'anchor_blocked', 'anchor_proposal_rejected', "
    "'effects_applied', 'cues_revealed', 'entity_line', 'judge_result', 'session_closed'"
)


def _swap(kinds: str) -> None:
    op.drop_constraint("ck_st_events_kind", "st_events", type_="check")
    op.create_check_constraint("ck_st_events_kind", "st_events", f"kind IN ({kinds})")


def upgrade() -> None:
    """Upgrade schema."""
    _swap(_NEW)


def downgrade() -> None:
    """Downgrade schema：只回退约束，**不删数据**。

    若库里已经存在这三类锚点事件，旧词表会**显式拒绝**这次降级（PG 报约束冲突）——
    这是刻意的：删数据不是迁移该替操作者做的决定。需要降级时先自行确认并清理，例如：

        DELETE FROM st_events WHERE kind IN ('anchor_satisfied', 'anchor_blocked', 'anchor_proposal_rejected');

    删掉的只是锚点的**过程证据**（达成/卡住/被拒提案）；学生动作、叙述、效果等原始证据不受影响，
    锚点状态本身可由事件流 × 声明重算，不受影响。
    """
    _swap(_OLD)
