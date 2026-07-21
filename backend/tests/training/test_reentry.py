"""Test assignment re-entry: 1.10 — re-entering an assignment never deletes existing data."""

from datetime import UTC, datetime, timedelta

from models import Assignment, NursingRecord


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


class TestAssignmentReentry:
    """Student starts assignment → gets record → starts again → same record, data intact."""

    def test_reentry_returns_same_record(
        self, client, teacher, student, test_case, test_class, test_student_in_class, db_session
    ):
        _, teacher_token = teacher
        _, student_token = student

        now = datetime.now(UTC)
        assignment = Assignment(
            case_id=test_case.id,
            features={},
            behavior={"time_limit_minutes": 20},
            class_id=test_class.id,
            teacher_id=teacher[0].id,
            title="重入测试作业",
            start_time=now,
            end_time=now + timedelta(days=7),
        )
        db_session.add(assignment)
        db_session.commit()
        db_session.refresh(assignment)

        resp1 = client.post(
            f"/api/training/start-from-assignment?assignment_id={assignment.id}",
            headers=_auth(student_token),
        )
        assert resp1.status_code == 200, f"First start failed: {resp1.text}"
        rid1 = resp1.json()["record_id"]

        assert resp1.json()["case_name"] == test_case.name

        nr = NursingRecord(record_id=rid1, user_id=student[0].id, sheet_data={"subjective": "hello"}, status="draft")
        db_session.add(nr)
        db_session.commit()

        resp2 = client.post(
            f"/api/training/start-from-assignment?assignment_id={assignment.id}",
            headers=_auth(student_token),
        )
        assert resp2.status_code == 200, f"Re-entry failed: {resp2.text}"
        rid2 = resp2.json()["record_id"]

        assert rid1 == rid2, f"Expected same record_id on re-entry, got {rid1} vs {rid2}"

        nr_check = db_session.query(NursingRecord).filter(NursingRecord.record_id == rid1).first()
        assert nr_check is not None, "NursingRecord should still exist after re-entry"
        assert nr_check.sheet_data == {"subjective": "hello"}, "NursingRecord data should be intact"

    def test_reentry_after_messages_returns_same_record(
        self, client, teacher, student, test_case, test_class, test_student_in_class, db_session
    ):
        _, teacher_token = teacher
        _, student_token = student

        now = datetime.now(UTC)
        assignment = Assignment(
            case_id=test_case.id,
            features={},
            behavior={"time_limit_minutes": 20},
            class_id=test_class.id,
            teacher_id=teacher[0].id,
            title="有消息重入作业",
            start_time=now,
            end_time=now + timedelta(days=7),
        )
        db_session.add(assignment)
        db_session.commit()
        db_session.refresh(assignment)

        resp1 = client.post(
            f"/api/training/start-from-assignment?assignment_id={assignment.id}",
            headers=_auth(student_token),
        )
        assert resp1.status_code == 200
        rid1 = resp1.json()["record_id"]

        nr = NursingRecord(record_id=rid1, user_id=student[0].id, sheet_data={"plan": "keep"}, status="draft")
        db_session.add(nr)
        db_session.commit()

        resp2 = client.post(
            f"/api/training/start-from-assignment?assignment_id={assignment.id}",
            headers=_auth(student_token),
        )
        assert resp2.status_code == 200
        rid2 = resp2.json()["record_id"]

        assert rid1 == rid2, f"Expected same record_id on re-entry (with messages), got {rid1} vs {rid2}"

        nr_check = db_session.query(NursingRecord).filter(NursingRecord.record_id == rid1).first()
        assert nr_check is not None, "NursingRecord should still exist after re-entry with messages"
