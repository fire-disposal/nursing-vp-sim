"""评分时间预算与成绩/状态原子性回归。"""

import asyncio

import pytest

from core.statuses import ScoringStatus
from models import Case, Score, TrainingRecord
from modules.training.scoring import engine
from tests.conftest import ensure_school, make_user

RUBRIC = {
    "raw_max": 2,
    "raw_scale": 2,
    "dimensions": [{"id": "d1", "name": "维度", "max": 2, "items": []}],
}


def _result() -> dict:
    return {
        "total_score": 80.0,
        "detail_scores": {},
        "strengths": [],
        "weaknesses": [],
        "missed_content": [],
        "suggestions": "",
        "raw_total": 2,
    }


def _record(db, scoring_status: str | None) -> TrainingRecord:
    school = ensure_school(db)
    user = make_user(db, school=school)
    case = Case(name="评分原子性病例", description="", difficulty=1, time_limit_minutes=30)
    db.add(case)
    db.flush()
    record = TrainingRecord(
        user_id=user.id,
        case_id=case.id,
        status="completed",
        scoring_status=scoring_status,
        case_snapshot={},
        rubric_snapshot=RUBRIC,
    )
    db.add(record)
    db.flush()
    return record


def test_score_and_completed_status_commit_atomically(pg_session):
    record = _record(pg_session, ScoringStatus.PROCESSING)

    score = engine._persist_score(_result(), RUBRIC, record.id, pg_session)

    assert score is not None
    assert record.scoring_status == ScoringStatus.COMPLETED
    assert record.scoring_error is None
    assert pg_session.query(Score).filter(Score.record_id == record.id).count() == 1


def test_newer_pending_retry_blocks_stale_worker_write(pg_session):
    record = _record(pg_session, ScoringStatus.PENDING)

    score = engine._persist_score(_result(), RUBRIC, record.id, pg_session)

    assert score is None
    assert record.scoring_status == ScoringStatus.PENDING
    assert pg_session.query(Score).filter(Score.record_id == record.id).count() == 0


def test_exhausted_stage_budget_does_not_get_extra_15_seconds(monkeypatch):
    called = False

    async def unexpected_stream(*args, **kwargs):
        nonlocal called
        called = True
        return {"unexpected": True}, False

    monkeypatch.setattr(engine, "_stream_attempt", unexpected_stream)
    stage = engine.StageConfig(
        pct_base=0,
        pct_range=10,
        progress_msg="评分",
        sse_stage="scoring",
        record_id=1,
    )

    with pytest.raises(TimeoutError):
        asyncio.run(
            engine._stage_with_retry(
                [],
                stage=stage,
                purpose="scoring",
                case_id=1,
                log_meta=None,
                llm_client=object(),
                llm_cfg={},
                validate_fn=lambda _: None,
                retry_prompt_template="",
                budget_seconds=0,
            )
        )
    assert called is False
