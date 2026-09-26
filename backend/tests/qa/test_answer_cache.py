"""QA 答复缓存的回归测试。

不变量：
1. 同一用户、完全相同的问句命中历史答复时**必须连同引用一起返回**——引用可追溯是
   产品承诺，早期实现返回剥离引用后的纯文本，导致界面失去来源卡片。
2. 未命中 → None（调用方走真实检索）。
3. 缓存按用户隔离：他人问过的同一问句不命中。

真库判据（**PostgreSQL**，`nursing_test`）：``qa_records.session_id`` / ``user_id`` 是真
外键（SQLite 默认不校验），故夹具在 savepoint 内先种出用例引用的用户与会话行；列
``created_at`` NOT NULL 无默认值，裸插必须显式给值。
"""

from datetime import UTC, datetime

import pytest
import sqlalchemy as sa

from core.database import Base
from core.database import engine as pg_engine
from models import QARecord, QASession, Role, User
from modules.qa.citations import embed_citations
from modules.qa.logic import get_cached_answer

_TABLES = [Role.__table__, User.__table__, QASession.__table__, QARecord.__table__]

#: 用例里引用的固定身份（真库这两张表为空；users 序列远大于 7，不会撞号）
_QA_USER_ID = 7
_QA_SESSION_ID = 1

_INSERT_RECORD = sa.text(
    "INSERT INTO qa_records (session_id, user_id, role, content, created_at) VALUES (:s, :u, :r, :c, :at)"
)


@pytest.fixture(scope="module", autouse=True)
def _schema():
    """本仓面向 PostgreSQL：真库建表（幂等），不再手写 SQLite DDL。"""
    Base.metadata.create_all(pg_engine, tables=_TABLES)


@pytest.fixture
def qa_db(pg_session):
    """savepoint 隔离 → 用例内部 flush 只落在 savepoint 里，对库零残留。"""
    role = pg_session.query(Role).filter(Role.name == "student").first() or Role(
        name="student", display_name="学生", is_system=True
    )
    pg_session.add(role)
    pg_session.flush()
    pg_session.query(QARecord).delete()  # 命中/未命中判据需要确定性的空表
    pg_session.add(
        User(id=_QA_USER_ID, username="qa-cache-user", password_hash="x", role_id=role.id, display_name="问答用户")
    )
    pg_session.add(QASession(id=_QA_SESSION_ID, user_id=_QA_USER_ID, title="问答会话"))
    pg_session.flush()
    return pg_session


def _seed(connection, *, session_id, user_id, question, answer, citations):
    # ``created_at`` 是 naïve 列：按列口径写 naïve-UTC（见 test_unreplied_summary 的说明）。
    at = datetime.now(UTC).replace(tzinfo=None)
    connection.execute(_INSERT_RECORD, {"s": session_id, "u": user_id, "r": "user", "c": question, "at": at})
    connection.execute(
        _INSERT_RECORD,
        {"s": session_id, "u": user_id, "r": "assistant", "c": embed_citations(answer, citations), "at": at},
    )
    connection.flush()


CITATIONS = [{"source": "新编护理学基础", "section": "第三章"}]


def test_hit_preserves_citations(qa_db):
    _seed(qa_db, session_id=1, user_id=7, question="低钾血症的护理要点？", answer="要点如下。", citations=CITATIONS)

    result = get_cached_answer("低钾血症的护理要点？", user_id=7, db=qa_db)

    assert result is not None
    answer, citations = result
    assert answer == "要点如下。"
    assert citations == CITATIONS


def test_hit_works_across_sessions_of_same_user(qa_db):
    _seed(qa_db, session_id=1, user_id=7, question="同一问句", answer="答复", citations=CITATIONS)

    assert get_cached_answer("同一问句", user_id=7, db=qa_db) is not None


def test_miss_for_unseen_question(qa_db):
    _seed(qa_db, session_id=1, user_id=7, question="已问过", answer="答复", citations=CITATIONS)

    assert get_cached_answer("从未问过", user_id=7, db=qa_db) is None


def test_isolated_per_user(qa_db):
    _seed(qa_db, session_id=1, user_id=7, question="别人的问句", answer="答复", citations=CITATIONS)

    assert get_cached_answer("别人的问句", user_id=8, db=qa_db) is None


def test_answer_without_citations_still_reusable(qa_db):
    _seed(qa_db, session_id=1, user_id=7, question="无引用问句", answer="无引用答复", citations=[])

    result = get_cached_answer("无引用问句", user_id=7, db=qa_db)

    assert result == ("无引用答复", None)
