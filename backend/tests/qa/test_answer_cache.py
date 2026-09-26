"""QA 答复缓存的回归测试。

不变量：
1. 同一用户、完全相同的问句命中历史答复时**必须连同引用一起返回**——引用可追溯是
   产品承诺，早期实现返回剥离引用后的纯文本，导致界面失去来源卡片。
2. 未命中 → None（调用方走真实检索）。
3. 缓存按用户隔离：他人问过的同一问句不命中。
"""

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from modules.qa.citations import embed_citations
from modules.qa.logic import get_cached_answer


@pytest.fixture
def qa_db():
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE qa_records ("
            " id INTEGER PRIMARY KEY, session_id INTEGER, user_id INTEGER,"
            " role VARCHAR(20), content TEXT, created_at DATETIME)"
        )
        yield connection
    engine.dispose()


def _seed(connection, *, session_id, user_id, question, answer, citations):
    connection.execute(
        text("INSERT INTO qa_records (session_id, user_id, role, content) VALUES (:s, :u, 'user', :c)"),
        {"s": session_id, "u": user_id, "c": question},
    )
    connection.execute(
        text("INSERT INTO qa_records (session_id, user_id, role, content) VALUES (:s, :u, 'assistant', :c)"),
        {"s": session_id, "u": user_id, "c": embed_citations(answer, citations)},
    )


CITATIONS = [{"source": "新编护理学基础", "section": "第三章"}]


def test_hit_preserves_citations(qa_db):
    _seed(qa_db, session_id=1, user_id=7, question="低钾血症的护理要点？", answer="要点如下。", citations=CITATIONS)
    with Session(bind=qa_db) as db:
        result = get_cached_answer("低钾血症的护理要点？", user_id=7, db=db)

    assert result is not None
    answer, citations = result
    assert answer == "要点如下。"
    assert citations == CITATIONS


def test_hit_works_across_sessions_of_same_user(qa_db):
    _seed(qa_db, session_id=1, user_id=7, question="同一问句", answer="答复", citations=CITATIONS)
    with Session(bind=qa_db) as db:
        assert get_cached_answer("同一问句", user_id=7, db=db) is not None


def test_miss_for_unseen_question(qa_db):
    _seed(qa_db, session_id=1, user_id=7, question="已问过", answer="答复", citations=CITATIONS)
    with Session(bind=qa_db) as db:
        assert get_cached_answer("从未问过", user_id=7, db=db) is None


def test_isolated_per_user(qa_db):
    _seed(qa_db, session_id=1, user_id=7, question="别人的问句", answer="答复", citations=CITATIONS)
    with Session(bind=qa_db) as db:
        assert get_cached_answer("别人的问句", user_id=8, db=db) is None


def test_answer_without_citations_still_reusable(qa_db):
    _seed(qa_db, session_id=1, user_id=7, question="无引用问句", answer="无引用答复", citations=[])
    with Session(bind=qa_db) as db:
        result = get_cached_answer("无引用问句", user_id=7, db=db)

    assert result == ("无引用答复", None)
