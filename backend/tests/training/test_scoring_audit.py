"""训练评分「复核提交」与「重试触发」的审计判据（真实 PG）。

复核会改写成绩口径（``Score.reviewed_total``），重试（尤其 force）会先删掉旧分/旧复核
再重算 —— 两者都改变"学生最终成绩"，属于必审事件（2026-09-26 审计 §3）。本文件断言
**库里的行内容**（action / target / outcome / payload 的 before-after），并守住两条边界：

  * 复核审计只记评论长度与明细条目数，**绝不**落评论正文与评分明细原文；
  * 重试只记"已成功触发"：400/403/409 拒绝路径与入队失败（503）都不留痕。

真库判据（PostgreSQL）：直接调用路由函数，`retry_scoring` 内部的 `db_session` 被接到
savepoint 会话上，用例结束后对库零残留。
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import modules.training.scoring.runner as runner_module
from core.audit import (
    ACTION_SCORE_RETRY_REQUESTED,
    ACTION_SCORE_REVIEW_SUBMITTED,
    TARGET_TYPE_TRAINING_RECORD,
)
from core.database import Base
from core.database import engine as pg_engine
from models import (
    Assignment,
    AuditLog,
    Case,
    CaseRevision,
    Class,
    Message,
    Role,
    Score,
    ScoreReview,
    TrainingRecord,
    User,
)
from models.school import legacy_grades_table
from modules.training.router import scoring as scoring_router
from modules.training.router.score_review import submit_score_review
from modules.training.router.scoring import retry_scoring
from schemas import ScoreReviewRequest

#: TrainingRecord 的外键目标必须一起建（PG 会校验真 FK）
_TABLES = [
    legacy_grades_table,
    Role.__table__,
    User.__table__,
    Class.__table__,
    Case.__table__,
    CaseRevision.__table__,
    Assignment.__table__,
    TrainingRecord.__table__,
    Message.__table__,
    Score.__table__,
    ScoreReview.__table__,
    AuditLog.__table__,
]

#: 复核正文含个人信息 —— 审计只允许留长度
_COMMENT = "患者王某某配合度好，但问诊缺少过敏史，电话 13800000000"
_DETAIL_TEXT = "评分明细原文"


@pytest.fixture(scope="module", autouse=True)
def _schema():
    Base.metadata.create_all(pg_engine, tables=_TABLES)


@pytest.fixture
def db(pg_session):
    return pg_session


@pytest.fixture
def patched_retry_session(monkeypatch, db):
    """`retry_scoring` 自建 session（`db_session()`）→ 接到 savepoint 会话上。

    同时把执行位置钉在 inline：否则 `SCORING_EXECUTION=job` 的机器上会往真库写 jobs 行。
    """

    @asynccontextmanager
    async def _session():
        yield db

    monkeypatch.setattr(scoring_router, "db_session", _session)
    monkeypatch.setattr(runner_module, "SCORING_EXECUTION", "inline")


class _Queue:
    """最小入队替身：只记录被入队的任务工厂（不执行它们）。"""

    def __init__(self) -> None:
        self.factories: list = []

    async def enqueue(self, coro_factory, priority: int = 0) -> None:
        self.factories.append(coro_factory)


def _user(db, name: str) -> User:
    role = db.query(Role).filter(Role.name == "teacher").first() or Role(
        name="teacher", display_name="教师", is_system=True
    )
    db.add(role)
    db.flush()
    user = User(username=name, password_hash="x", display_name=name, role_id=role.id)
    db.add(user)
    db.flush()
    # 直调路由 = 绕过 require_permission 依赖；has_permission 读的是实例缓存
    user.set_permissions_cache({"score_review"})
    return user


def _record(db, user: User, status: str = "completed") -> TrainingRecord:
    case = Case(name="评分审计病例", description="", difficulty=1, time_limit_minutes=30)
    db.add(case)
    db.flush()
    record = TrainingRecord(
        user_id=user.id,
        case_id=case.id,
        status=status,
        case_snapshot={"patient_info": {"name": "王某"}},
        # 非空 rubric 快照 → 复核换算不再按 workflow 重建。
        # 条目 id 必须真实存在：复核写入按原始条目收敛，未知条目会被丢弃（不计分）。
        rubric_snapshot={
            "id": "audit_rubric",
            "version": "1.0",
            "raw_max": 38,
            "raw_scale": 2,
            "dimensions": [
                {"id": "communication", "name": "沟通技能", "max": 4, "items": [{"id": "c0", "name": "沟通条目"}]},
                {"id": "history_taking", "name": "病史采集", "max": 4, "items": [{"id": "h0", "name": "病史条目"}]},
            ],
        },
    )
    db.add(record)
    db.flush()
    return record


def _score(db, record: TrainingRecord, total: float = 80.0, reviewed_total: float | None = None) -> Score:
    score = Score(
        record_id=record.id,
        total_score=total,
        detail_scores={"沟通技能": {"score": 5, "max": 100, "items": []}},
        reviewed_total=reviewed_total,
    )
    db.add(score)
    db.flush()
    return score


def _student_message(db, record: TrainingRecord) -> None:
    db.add(Message(record_id=record.id, role="student", content="老师您好，我最近头晕"))
    db.flush()


def _detail(item_score: int = 2) -> dict:
    """两个维度的**原始条目**明细（0-raw_scale）：item 2 → Σ4 → 展示 11（≠ 任何输入值）。

    复核编辑的就是原始条目（docs/19 §4.2 第 6 条），所以这里给的是 raw 刻度。
    """
    return {
        "沟通技能": {
            "score": item_score,
            "max": 2,
            "items": [
                {
                    "id": "c0",
                    "name": "沟通条目",
                    "score": item_score,
                    "max": 2,
                    "evidence": _DETAIL_TEXT,
                    "reason": _DETAIL_TEXT,
                }
            ],
        },
        "病史采集": {
            "score": item_score,
            "max": 2,
            "items": [
                {
                    "id": "h0",
                    "name": "病史条目",
                    "score": item_score,
                    "max": 2,
                    "evidence": _DETAIL_TEXT,
                    "reason": _DETAIL_TEXT,
                }
            ],
        },
    }


def _request(actor: User, rid: str, path: str = "/api/training/1/retry-scoring", queue=None) -> SimpleNamespace:
    return SimpleNamespace(
        state=SimpleNamespace(request_id=rid, audit_actor=actor),
        headers={"user-agent": "pytest", "X-Real-IP": "10.1.2.3"},
        method="POST",
        url=SimpleNamespace(path=path),
        client=None,
        app=SimpleNamespace(
            state=SimpleNamespace(
                task_queue=queue if queue is not None else _Queue(),
                llm_client=None,
                scoring_tracker=None,
                realtime_hub=None,
            )
        ),
    )


def _rows(db, action: str) -> list[AuditLog]:
    return db.query(AuditLog).filter(AuditLog.action == action).order_by(AuditLog.id).all()


# ── 复核提交 ──────────────────────────────────────────────────────────────


def test_first_review_writes_one_row_matching_stored_total(db):
    teacher = _user(db, "audit-review-teacher-1")
    record = _record(db, teacher)
    score = _score(db, record, total=80.0)

    resp = submit_score_review(
        record.id,
        ScoreReviewRequest(detail_scores=_detail(), comment=_COMMENT),
        _request(teacher, "req-review-1"),
        teacher,
        db,
    )

    db.refresh(score)
    assert score.reviewed_total == 11  # raw 2+2 → Σ4 → 展示 11（不是照抄输入）
    rows = _rows(db, ACTION_SCORE_REVIEW_SUBMITTED)
    assert len(rows) == 1
    row = rows[0]
    assert row.target_type == TARGET_TYPE_TRAINING_RECORD
    assert row.target_id == str(record.id)
    assert row.outcome == "success"
    assert row.actor_id == teacher.id
    assert row.request_id == "req-review-1"
    assert row.ip == "10.1.2.3"
    assert row.payload == {
        "score_id": score.id,
        "previous_reviewed_total": None,
        "reviewed_total": 11,
        "review_status": "created",
        # 复核基准必须留痕：历史记录按展示层反推，否则事后无法解释复核依据
        "review_basis": "legacy_display_derived",
        "applicable_raw_max": 38.0,
        "detail_score_count": 2,
        "comment_length": len(_COMMENT),
    }
    # 审计记的就是落库值
    assert row.payload["reviewed_total"] == score.reviewed_total == resp.review_total_score


def test_second_review_audits_update_with_previous_total(db):
    teacher = _user(db, "audit-review-teacher-2")
    record = _record(db, teacher)
    score = _score(db, record, total=80.0)

    submit_score_review(
        record.id,
        ScoreReviewRequest(detail_scores=_detail(), comment="第一次复核"),
        _request(teacher, "req-review-a"),
        teacher,
        db,
    )
    db.refresh(score)
    first_total = score.reviewed_total

    # 第二次：全部条目 0 分 → 复核总分 0（与第一次可区分）
    submit_score_review(
        record.id,
        ScoreReviewRequest(detail_scores=_detail(item_score=0), comment="改判"),
        _request(teacher, "req-review-b"),
        teacher,
        db,
    )
    db.refresh(score)

    rows = _rows(db, ACTION_SCORE_REVIEW_SUBMITTED)
    assert [r.payload["review_status"] for r in rows] == ["created", "updated"]
    assert rows[1].payload["previous_reviewed_total"] == first_total == 11
    assert rows[1].payload["reviewed_total"] == score.reviewed_total == 0
    assert [r.request_id for r in rows] == ["req-review-a", "req-review-b"]
    # 复核行是更新不是新增（唯一约束下仍只有一行）
    assert db.query(ScoreReview).filter(ScoreReview.score_id == score.id).count() == 1


def test_review_audit_never_stores_comment_or_detail_text(db):
    teacher = _user(db, "audit-review-teacher-3")
    record = _record(db, teacher)
    _score(db, record, total=80.0)

    submit_score_review(
        record.id,
        ScoreReviewRequest(detail_scores=_detail(), comment=_COMMENT),
        _request(teacher, "req-review-pii"),
        teacher,
        db,
    )

    row = _rows(db, ACTION_SCORE_REVIEW_SUBMITTED)[0]
    assert set(row.payload) == {
        "score_id",
        "previous_reviewed_total",
        "reviewed_total",
        "review_status",
        "review_basis",
        "applicable_raw_max",
        "detail_score_count",
        "comment_length",
    }
    serialized = str(row.payload)
    assert "王某某" not in serialized
    assert _DETAIL_TEXT not in serialized
    # 正文留在业务表里（审计只是副本的替代品，不搬内容）
    review = db.query(ScoreReview).filter(ScoreReview.score_id == row.payload["score_id"]).one()
    assert review.comment == _COMMENT
    # 复核行保存的是教师改动的**原始条目**（分值 + 条目 id），不搬运 AI 的 evidence/reason
    # 文本：那部分留在 Score.raw_detail_scores（AI 判据不被复核覆盖，docs/19 §4.2 第 7 条）。
    assert review.detail_scores["沟通技能"]["items"][0] == {"id": "c0", "name": "沟通条目", "score": 2.0, "max": 2}
    assert _DETAIL_TEXT not in str(review.detail_scores)


# ── 重试 / force 重算 ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_retry_without_old_score_audits_trigger(db, patched_retry_session):
    teacher = _user(db, "audit-retry-teacher-1")
    record = _record(db, teacher)
    _student_message(db, record)
    queue = _Queue()

    await retry_scoring(record.id, _request(teacher, "req-retry-1", queue=queue), teacher, force=False)

    assert len(queue.factories) == 1  # 真的触发了才会留痕
    rows = _rows(db, ACTION_SCORE_RETRY_REQUESTED)
    assert len(rows) == 1
    row = rows[0]
    assert row.target_type == TARGET_TYPE_TRAINING_RECORD
    assert row.target_id == str(record.id)
    assert row.outcome == "success"
    assert row.request_id == "req-retry-1"
    assert row.payload == {
        "force": False,
        "had_score": False,
        "had_review": False,
        "previous_total_score": None,
        "previous_reviewed_total": None,
    }


@pytest.mark.asyncio
async def test_force_retry_audits_deleted_previous_values(db, patched_retry_session):
    teacher = _user(db, "audit-retry-teacher-2")
    record = _record(db, teacher)
    _student_message(db, record)
    score = _score(db, record, total=77.0, reviewed_total=64.0)
    score_id = score.id
    db.add(ScoreReview(score_id=score_id, reviewed_by=teacher.id, total_score=64.0, comment="旧复核"))
    db.flush()
    queue = _Queue()

    await retry_scoring(record.id, _request(teacher, "req-retry-force", queue=queue), teacher, force=True)

    assert len(queue.factories) == 1
    rows = _rows(db, ACTION_SCORE_RETRY_REQUESTED)
    assert len(rows) == 1
    assert rows[0].payload == {
        "force": True,
        "had_score": True,
        "had_review": True,
        "previous_total_score": 77.0,
        "previous_reviewed_total": 64.0,
    }
    # before 快照只能来自删除前：force 路径确实删掉了旧分/旧复核（同一事务）
    db.expire_all()
    assert db.query(Score).filter(Score.record_id == record.id).count() == 0
    assert db.query(ScoreReview).filter(ScoreReview.score_id == score_id).count() == 0
    assert db.query(TrainingRecord).filter(TrainingRecord.id == record.id).one().scoring_status == "pending"


@pytest.mark.asyncio
async def test_refused_retry_leaves_no_audit_and_no_deletion(db, patched_retry_session):
    """已有复核且未带 force → 409：旧分/旧复核原样保留，且不留任何审计行。"""
    teacher = _user(db, "audit-retry-teacher-3")
    record = _record(db, teacher)
    _student_message(db, record)
    score = _score(db, record, total=77.0, reviewed_total=64.0)
    score_id = score.id
    db.add(ScoreReview(score_id=score_id, reviewed_by=teacher.id, total_score=64.0, comment="旧复核"))
    db.flush()

    with pytest.raises(HTTPException) as exc:
        await retry_scoring(record.id, _request(teacher, "req-retry-conflict"), teacher, force=False)

    assert exc.value.status_code == 409
    assert _rows(db, ACTION_SCORE_RETRY_REQUESTED) == []
    db.expire_all()
    assert db.query(Score).filter(Score.id == score_id).count() == 1
    assert db.query(ScoreReview).filter(ScoreReview.score_id == score_id).count() == 1
    # 评分未被抢占（acquire_scoring 都没走到）
    assert db.query(TrainingRecord).filter(TrainingRecord.id == record.id).one().scoring_status is None
