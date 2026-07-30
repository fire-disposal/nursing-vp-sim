"""Tests for D2 review integrity — Score.total_score immutable, ScoreReview.total_score populated, detail returns review."""

from models import Score, ScoreReview, TrainingRecord


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


def _add_score(db_session, record_id, total_score=80):
    score = Score(
        record_id=record_id,
        total_score=total_score,
        detail_scores={
            "沟通技能": {"score": 28, "max": 42, "items": [{"name": "倾听", "score": 2, "max": 3}]},
            "病史采集": {"score": 10, "max": 15, "items": [{"name": "完整性", "score": 2, "max": 3}]},
        },
        strengths=["a"],
        weaknesses=["b"],
        missed_content=["c"],
        suggestions="d",
        rubric_version="v1",
        prompt_version=0,
    )
    db_session.add(score)
    db_session.commit()
    db_session.refresh(score)
    return score


class TestReviewIntegrity:
    def test_submit_review_does_not_change_score_total(self, client, student, teacher, test_case, db_session):
        """Score.total_score stays at AI-original after teacher review."""
        test_case.is_open = True
        db_session.commit()

        student_user, student_token = student
        teacher_user, teacher_token = teacher

        record_id = _start_training(client, student_token, test_case.id)
        _complete_record(db_session, record_id)

        ai_original_total = 80.0
        score = _add_score(db_session, record_id, total_score=ai_original_total)

        modified_detail = {
            "沟通技能": {"score": 35, "max": 42, "items": [{"name": "倾听", "score": 3, "max": 3}]},
            "病史采集": {"score": 12, "max": 15, "items": [{"name": "完整性", "score": 3, "max": 3}]},
        }

        resp = client.post(
            f"/api/training/records/{record_id}/review",
            json={"detail_scores": modified_detail, "comment": "调整后复核"},
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert resp.status_code == 200

        db_session.expire_all()
        updated_score = db_session.query(Score).filter(Score.record_id == record_id).first()
        assert updated_score.total_score == ai_original_total

    def test_submit_review_writes_total_to_review(self, client, student, teacher, test_case, db_session):
        """ScoreReview.total_score is populated with recalculated total."""
        test_case.is_open = True
        db_session.commit()

        student_user, student_token = student
        teacher_user, teacher_token = teacher

        record_id = _start_training(client, student_token, test_case.id)
        _complete_record(db_session, record_id)
        score = _add_score(db_session, record_id)

        modified_detail = {
            "沟通技能": {"score": 35, "max": 42, "items": [{"name": "倾听", "score": 3, "max": 3}]},
            "病史采集": {"score": 12, "max": 15, "items": [{"name": "完整性", "score": 3, "max": 3}]},
        }

        resp = client.post(
            f"/api/training/records/{record_id}/review",
            json={"detail_scores": modified_detail, "comment": "调整后复核"},
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["review_total_score"] is not None
        assert isinstance(data["review_total_score"], (int, float))
        assert data["review_total_score"] > 0

        db_session.expire_all()
        review = db_session.query(ScoreReview).filter(ScoreReview.score_id == score.id).first()
        assert review is not None
        assert review.total_score is not None
        assert review.total_score == data["review_total_score"]

    def test_record_detail_includes_review_data(self, client, student, teacher, test_case, db_session):
        """TrainingRecordDetail score.review contains review data after submit."""
        test_case.is_open = True
        db_session.commit()

        student_user, student_token = student
        teacher_user, teacher_token = teacher

        record_id = _start_training(client, student_token, test_case.id)
        _complete_record(db_session, record_id)
        _add_score(db_session, record_id)

        modified_detail = {
            "沟通技能": {"score": 35, "max": 42, "items": [{"name": "倾听", "score": 3, "max": 3}]},
        }

        resp = client.post(
            f"/api/training/records/{record_id}/review",
            json={"detail_scores": modified_detail, "comment": "不错"},
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert resp.status_code == 200

        detail_resp = client.get(
            f"/api/training/records/{record_id}",
            headers={"Authorization": f"Bearer {student_token}"},
        )
        assert detail_resp.status_code == 200
        detail = detail_resp.json()

        assert detail["score"] is not None
        assert detail["score"]["review"] is not None
        review_field = detail["score"]["review"]
        assert review_field["detail_scores"] is not None
        assert review_field["total_score"] is not None
        assert review_field["comment"] == "不错"
        assert review_field["reviewed_at"] is not None

    def test_record_detail_no_review_when_none(self, client, student, test_case, db_session):
        """TrainingRecordDetail score.review is None when no review exists."""
        test_case.is_open = True
        db_session.commit()

        student_user, student_token = student

        record_id = _start_training(client, student_token, test_case.id)
        _complete_record(db_session, record_id)
        _add_score(db_session, record_id)

        detail_resp = client.get(
            f"/api/training/records/{record_id}",
            headers={"Authorization": f"Bearer {student_token}"},
        )
        assert detail_resp.status_code == 200
        detail = detail_resp.json()

        assert detail["score"] is not None
        assert detail["score"]["review"] is None
