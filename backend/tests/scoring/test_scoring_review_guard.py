"""Tests for retry_scoring review guard — protects existing teacher reviews."""

from models import Message, Score, ScoreReview, TrainingRecord


def _start_training(client, token, case_id):
    resp = client.post(
        "/api/training/start",
        json={"case_id": case_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    return resp.json()["record_id"]


def _complete_record(db_session, record_id):
    record = db_session.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    record.status = "completed"
    db_session.commit()


def _add_enough_messages(db_session, record_id):
    _LONG = "您好，我是今天值班的护士小张。请问您怎么称呼？今天来医院是有什么不舒服的地方吗？请您详细描述一下您的主要症状和不适感。"
    msgs = [
        Message(record_id=record_id, role="student", content=_LONG),
        Message(
            record_id=record_id,
            role="student",
            content="请问您最近有什么不舒服的症状？比如头痛、头晕或者胸闷心慌之类的？大概是什么时候开始出现的？持续了多长时间？能具体描述一下症状的性质和部位吗？",
        ),
        Message(
            record_id=record_id,
            role="student",
            content="您的血压平时是多少呢？平时有没有头晕、头痛或者心慌的情况出现？家族里有没有高血压、糖尿病这些慢性病史呢？平时有抽烟喝酒的习惯吗？好的，我记下了。",
        ),
    ]
    db_session.add_all(msgs)
    db_session.commit()


def _add_score_and_review(db_session, record_id, reviewer_id):
    score = Score(
        record_id=record_id,
        total_score=80,
        detail_scores={},
        strengths=["a"],
        weaknesses=["b"],
        missed_content=["c"],
        suggestions="d",
        rubric_version="v1",
        prompt_version=0,
    )
    db_session.add(score)
    db_session.flush()
    review = ScoreReview(score_id=score.id, reviewed_by=reviewer_id, detail_scores={}, comment="good")
    db_session.add(review)
    db_session.commit()
    return score


class TestRetryScoringReviewGuard:
    def test_student_retry_with_review_returns_403(self, client, student, teacher, test_case, db_session):
        """Students cannot retry scoring once a teacher has reviewed."""
        test_case.is_open = True
        db_session.commit()

        student_user, student_token = student
        teacher_user, teacher_token = teacher

        record_id = _start_training(client, student_token, test_case.id)
        _add_enough_messages(db_session, record_id)
        _complete_record(db_session, record_id)
        _add_score_and_review(db_session, record_id, teacher_user.id)

        resp = client.post(
            f"/api/training/{record_id}/retry-scoring",
            headers={"Authorization": f"Bearer {student_token}"},
        )
        assert resp.status_code == 403
        assert "复核" in resp.json()["detail"]

    def test_teacher_retry_without_force_returns_409(self, client, student, teacher, test_case, db_session):
        """Teachers must pass force=true to override an existing review."""
        test_case.is_open = True
        db_session.commit()

        student_user, student_token = student
        teacher_user, teacher_token = teacher

        record_id = _start_training(client, student_token, test_case.id)
        _add_enough_messages(db_session, record_id)
        _complete_record(db_session, record_id)
        _add_score_and_review(db_session, record_id, teacher_user.id)

        resp = client.post(
            f"/api/training/{record_id}/retry-scoring",
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert resp.status_code == 409
        assert "force=true" in resp.json()["detail"]

    def test_teacher_retry_with_force_succeeds(self, client, student, teacher, test_case, db_session):
        """Teacher with force=true can retry scoring even with existing review."""
        test_case.is_open = True
        db_session.commit()

        student_user, student_token = student
        teacher_user, teacher_token = teacher

        record_id = _start_training(client, student_token, test_case.id)
        _add_enough_messages(db_session, record_id)
        _complete_record(db_session, record_id)
        _add_score_and_review(db_session, record_id, teacher_user.id)

        resp = client.post(
            f"/api/training/{record_id}/retry-scoring?force=true",
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["scoring_status"] == "pending"

        # Old Score and ScoreReview should be deleted
        db_session.expire_all()
        old_score = db_session.query(Score).filter(Score.record_id == record_id).first()
        assert old_score is None
        old_review = db_session.query(ScoreReview).filter(ScoreReview.score_id.isnot(None)).all()
        assert len(old_review) == 0

    def test_student_retry_without_review_succeeds(self, client, student, test_case, db_session):
        """Students can retry scoring normally when no review exists."""
        test_case.is_open = True
        db_session.commit()

        student_user, student_token = student

        record_id = _start_training(client, student_token, test_case.id)
        _add_enough_messages(db_session, record_id)
        _complete_record(db_session, record_id)

        # Add score but NO review
        score = Score(
            record_id=record_id,
            total_score=70,
            detail_scores={},
            strengths=["a"],
            weaknesses=["b"],
            missed_content=["c"],
            suggestions="d",
            rubric_version="v1",
            prompt_version=0,
        )
        db_session.add(score)
        db_session.commit()

        resp = client.post(
            f"/api/training/{record_id}/retry-scoring",
            headers={"Authorization": f"Bearer {student_token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["scoring_status"] == "pending"


import pytest

pytestmark = pytest.mark.integration
