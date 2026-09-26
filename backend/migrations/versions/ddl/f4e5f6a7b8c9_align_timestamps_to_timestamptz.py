"""align_timestamps_to_timestamptz

把 25 个历史遗留的 `timestamp without time zone` 列统一改成 `timestamptz`。

**为什么可以这样换算**（这是本迁移的正确性前提）：
这些列的写入路径一直是"应用给出 aware 值（或 NOW()）→ PG 按**会话时区**折算成墙钟存进 naïve 列"，
而生产与本地会话时区都是 `Asia/Shanghai`（`deploy/docker-compose.prod.yml` 与 test compose 均显式设置）。
所以**存量值就是上海墙钟** → `c AT TIME ZONE 'Asia/Shanghai'` 得到的才是真正的时刻。

**修掉的缺陷**（2026-09-26 由"测试全面转向 PG"挖出，见 docs/review/refactor-plan-2026-09-26.md §2.12）：
naïve 列读回被当成 UTC 解释 → 后台"最老一条 / 未回复天数"等偏 **8 小时**。

模型层早已全部声明 `DateTime(timezone=True)`（0 处遗漏），本迁移让库与模型对齐 —— 是漂移修复，不是新约定。

**注意**：`ALTER … TYPE` 会重写表并持有 ACCESS EXCLUSIVE 锁；大表（messages / training_actions /
llm_call_logs）在低峰执行更稳。downgrade 用 `AT TIME ZONE 'Asia/Shanghai'` 逆向折算回墙钟。

Revision ID: f4e5f6a7b8c9
Revises: f3d4e5f6a7b8
Create Date: 2026-09-26

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f4e5f6a7b8c9"
down_revision: str | Sequence[str] | None = "f3d4e5f6a7b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 现场与库（Asia/Shanghai）一致的墙钟语义 —— 改列类型时必须显式给定，不要依赖会话默认
TZ = "Asia/Shanghai"

_COLUMNS: tuple[tuple[str, str], ...] = (
    ("api_secrets", "degraded_until"),
    ("api_secrets", "last_used_at"),
    ("api_secrets", "stats_date"),
    ("classes", "created_at"),
    ("feedback_images", "created_at"),
    ("feedbacks", "auto_fix_at"),
    ("feedbacks", "created_at"),
    ("feedbacks", "replied_at"),
    ("llm_call_logs", "created_at"),
    ("messages", "created_at"),
    ("notifications", "created_at"),
    ("notifications", "updated_at"),
    ("qa_records", "created_at"),
    ("questionnaire_responses", "completed_at"),
    ("questionnaire_responses", "created_at"),
    ("score_reviews", "created_at"),
    ("scores", "created_at"),
    ("system_notifications", "published_at"),
    ("training_actions", "created_at"),
    ("training_session_state", "created_at"),
    ("training_session_state", "updated_at"),
    ("user_class", "joined_at"),
    ("users", "last_login_at"),
    ("voice_call_logs", "created_at"),
)


def upgrade() -> None:
    for table, column in _COLUMNS:
        op.alter_column(
            table,
            column,
            type_=sa.DateTime(timezone=True),
            existing_type=sa.DateTime(timezone=False),
            existing_nullable=True,
            postgresql_using=f"{column} AT TIME ZONE '{TZ}'",
        )


def downgrade() -> None:
    for table, column in _COLUMNS:
        op.alter_column(
            table,
            column,
            type_=sa.DateTime(timezone=False),
            existing_type=sa.DateTime(timezone=True),
            existing_nullable=True,
            postgresql_using=f"{column} AT TIME ZONE '{TZ}'",
        )
