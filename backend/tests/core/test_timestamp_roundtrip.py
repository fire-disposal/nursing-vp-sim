"""时间戳往返判据（真实 PG，会话时区 Asia/Shanghai）。

**本该早就存在的判据**：naïve 列（`timestamp without time zone`）在非 UTC 会话时区下会把
aware 写入折算成墙钟、读回再被当 UTC 解释 → 偏 8 小时（2026-09-26 由"测试全面转向 PG"挖出，
见 docs/review/refactor-plan-2026-09-26.md §2.12 / docs/ops/timezone-alignment.md）。

对代表性列断言：写入一个 aware-UTC 时刻，读回的瞬间必须相等。
修前（列仍是 naïve）本判据失败 —— 这正是它的价值。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa

from core.database import Base
from core.database import engine as pg_engine
from models import Feedback, Role, User

_TABLES = [Role.__table__, User.__table__, Feedback.__table__]

# 会话时区必须是 Asia/Shanghai —— 否则"偏 8 小时"这个前提不成立（判据也就失去意义）
_EXPECTED_TZ = "Asia/Shanghai"


@pytest.fixture(scope="module", autouse=True)
def _schema():
    Base.metadata.create_all(pg_engine, tables=_TABLES)


@pytest.fixture
def db(pg_session):
    return pg_session


def _naive_columns(table: str) -> list[str]:
    with pg_engine.connect() as conn:
        rows = conn.execute(
            sa.text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = :t AND data_type = 'timestamp without time zone'"
            ),
            {"t": table},
        ).all()
    return [r[0] for r in rows]


def test_session_timezone_is_shanghai(db):
    tz = db.execute(sa.text("SHOW timezone")).scalar()
    assert tz == _EXPECTED_TZ, f"会话时区为 {tz}，本判据的前提是 {_EXPECTED_TZ}"


def test_no_naive_timestamp_columns_remain(db):
    """回归判据：这些表不得再有 `timestamp without time zone` 列（迁移 f4e5f6a7b8c9 的目标）。"""
    offenders: dict[str, list[str]] = {}
    for table in (
        "feedbacks",
        "scores",
        "qa_records",
        "llm_call_logs",
        "messages",
        "notifications",
        "training_actions",
        "training_session_state",
        "classes",
        "users",
        "user_class",
        "score_reviews",
        "questionnaire_responses",
        "voice_call_logs",
        "system_notifications",
        "feedback_images",
        "api_secrets",
    ):
        cols = _naive_columns(table)
        if cols:
            offenders[table] = cols
    assert not offenders, f"仍有 naïve 时间列（会造成 8 小时偏差）：{offenders}"


def test_aware_write_reads_back_same_instant(db):
    """写入 aware-UTC → 读回必须还是同一瞬间（旧 naïve 列上会差 8 小时）。"""
    role = db.query(Role).filter(Role.name == "student").first() or Role(
        name="student", display_name="学生", is_system=True
    )
    db.add(role)
    db.flush()
    author = User(
        username="ts-roundtrip-author",
        password_hash="x",
        role_id=role.id,
        display_name="往返用户",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db.add(author)
    db.flush()

    written = datetime.now(UTC) - timedelta(days=3)
    fb = Feedback(user_id=author.id, rating=5, tag="bug", content="时间戳往返", version="1.0", created_at=written)
    db.add(fb)
    db.flush()
    fb_id = fb.id
    db.expire_all()

    read_back = db.query(Feedback).filter(Feedback.id == fb_id).one().created_at
    assert read_back.tzinfo is not None, "读回的值必须是 aware（列应为 timestamptz）"
    assert abs((read_back - written).total_seconds()) < 1, (
        f"往返偏移 {(read_back - written).total_seconds() / 3600:.1f} 小时"
    )
