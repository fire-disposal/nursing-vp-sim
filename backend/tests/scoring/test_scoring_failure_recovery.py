"""force 重评失败恢复的闭环（S6 残余）。

守护：
- 新评分失败 → 从 runtime_state 快照恢复旧分/旧复核，且 ``scoring_status``
  必须回到 ``completed``（"有 Score ⇒ completed" 不变量）；恢复出的分不可见
  是这条不变量漏写一次的后果。
- 恢复必须逐字段无损（``dim_total``/``reviewed_at`` 曾因字段漏写而丢失）。
- 无快照的失败仍然 ``failed`` + 通知，不能被"总是 completed"掩盖。
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import modules.training.router.scoring as scoring_router
from core.statuses import ScoringStatus
from models import Notification, Score, ScoreReview, TrainingRecord

REVIEWED_AT = datetime(2026, 3, 1, 12, 0, tzinfo=UTC)
DETAIL: dict[str, Any] = {"沟通技能": {"score": 4, "max": 5, "items": [{"id": "c1", "score": 4, "max": 5}]}}


class _First:
    def __init__(self, session: _FakeSession, model: object) -> None:
        self._session = session
        self._model = model

    def filter(self, *_criteria: object) -> _First:
        return self

    def first(self) -> object | None:
        return self._session.resolve(self._model)


class _FakeSession:
    """``_handle_scoring_failure`` 的最小 Session 替身（无 DB）。"""

    def __init__(self, record: TrainingRecord) -> None:
        self.record = record
        self.score: Score | None = None
        self.reviews: list[ScoreReview] = []
        self.notifications: list[Notification] = []
        self.commits = 0

    def resolve(self, model: object) -> object | None:
        if model is TrainingRecord:
            return self.record
        if model is Score:
            return self.score
        return None

    def expire_all(self) -> None:
        pass

    def query(self, model: object) -> _First:
        return _First(self, model)

    def add(self, obj: object) -> None:
        if isinstance(obj, Score):
            self.score = obj
        elif isinstance(obj, ScoreReview):
            self.reviews.append(obj)
        elif isinstance(obj, Notification):
            self.notifications.append(obj)

    def flush(self) -> None:
        if self.score is not None and self.score.id is None:
            self.score.id = 4242

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        pass

    def close(self) -> None:
        pass


def _old_score() -> Score:
    return Score(
        id=1,
        record_id=7,
        total_score=88.0,
        detail_scores=DETAIL,
        strengths=["优点"],
        weaknesses=["不足"],
        missed_content=["漏问"],
        suggestions="建议",
        rubric_version="nursing_history_v1@1.0",
        model_name="deepseek-chat",
        prompt_version=2,
        raw_total=33.5,
        mapping_version=1,
        fallback=None,
        dim_total={"沟通技能": {"score": 4, "max": 5}},
        reviewed_total=91.0,
        reviewed_at=REVIEWED_AT,
    )


def _record_with_snapshot() -> TrainingRecord:
    review = ScoreReview(id=3, score_id=1, reviewed_by=9, detail_scores=DETAIL, total_score=91.0, comment="复核通过")
    snapshot = scoring_router._snapshot_score_for_rescore(_old_score(), review)
    return TrainingRecord(
        id=7,
        user_id=3,
        status="completed",
        scoring_status=ScoringStatus.PROCESSING,
        runtime_state={"force_rescore_snapshot": snapshot},
    )


def test_force_rescore_failure_restores_old_score_as_completed(monkeypatch):
    """新评分失败 → 旧分/旧复核恢复，且状态回到 completed（分才能在成绩管理处可见）。"""
    record = _record_with_snapshot()
    db = _FakeSession(record)
    monkeypatch.setattr(scoring_router, "SessionLocal", lambda: db)

    scoring_router._handle_scoring_failure(7, "评分超时")

    assert record.scoring_status == ScoringStatus.COMPLETED
    assert record.scoring_error is None
    assert db.score is not None
    assert db.score.record_id == 7
    assert db.score.total_score == 88.0
    assert db.score.reviewed_total == 91.0
    assert db.score.reviewed_at == REVIEWED_AT
    assert db.score.dim_total == {"沟通技能": {"score": 4, "max": 5}}
    assert db.score.mapping_version == 1
    assert db.score.fallback is None
    assert [r.total_score for r in db.reviews] == [91.0]
    assert db.reviews[0].score is db.score
    assert "force_rescore_snapshot" not in (record.runtime_state or {})
    # 分已恢复 ⇒ 不再发"评分失败"通知
    assert db.notifications == []


def test_force_rescore_snapshot_covers_every_persisted_score_column():
    """快照字段集合必须覆盖 Score/ScoreReview 的全部持久化列（漏字段 = 恢复后静默丢数据）。

    ``created_at`` 两侧都不复原：恢复出的行是"同一份内容重新落库"，时间戳记新行。
    """
    score_columns = {c.name for c in Score.__table__.columns} - {"id", "record_id", "created_at"}
    assert set(scoring_router._SCORE_SNAPSHOT_FIELDS) == score_columns

    review_columns = {c.name for c in ScoreReview.__table__.columns} - {"id", "score_id", "created_at"}
    assert set(scoring_router._SCORE_REVIEW_SNAPSHOT_FIELDS) == review_columns


def test_restore_from_empty_snapshot_returns_none():
    assert scoring_router._restore_score_from_snapshot({}, 7) is None
    assert scoring_router._restore_score_from_snapshot({"review": {"comment": "x"}}, 7) is None


def test_failure_without_snapshot_stays_failed_and_notifies(monkeypatch):
    """无快照可恢复 → 仍然是 failed + 失败通知（恢复分支不能吞掉真实失败）。"""
    record = TrainingRecord(
        id=7, user_id=3, status="completed", scoring_status=ScoringStatus.PROCESSING, runtime_state={}
    )
    db = _FakeSession(record)
    monkeypatch.setattr(scoring_router, "SessionLocal", lambda: db)

    scoring_router._handle_scoring_failure(7, "LLM 返回空")

    assert record.scoring_status == ScoringStatus.FAILED
    assert record.scoring_error == "LLM 返回空"
    assert [n.type for n in db.notifications] == ["scoring_failed"]
