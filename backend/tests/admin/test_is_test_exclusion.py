"""Test is_test auto-flagging and exclusion from statistics."""

from datetime import UTC, datetime, timedelta

from models import TrainingRecord


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_admin_training_is_test(
    client,
    teacher,
    test_case,
    db_session,
):
    """Admin/teacher with case_manage starts training -> is_test=True."""
    user, token = teacher
    resp = client.post(
        "/api/training/start",
        json={"case_id": test_case.id},
        headers=_auth_headers(token),
    )
    assert resp.status_code == 200, resp.text
    record_id = resp.json()["record_id"]
    record = db_session.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    assert record is not None
    assert record.is_test is True


def test_student_training_not_is_test(
    client,
    student,
    test_case,
    db_session,
):
    """Student starts training -> is_test=False."""
    user, token = student
    resp = client.post(
        "/api/training/start",
        json={"case_id": test_case.id},
        headers=_auth_headers(token),
    )
    assert resp.status_code == 200, resp.text
    record_id = resp.json()["record_id"]
    record = db_session.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    assert record is not None
    assert record.is_test is False


def test_stats_exclude_is_test(
    client,
    teacher,
    student,
    test_case,
    db_session,
):
    """Stats endpoints exclude is_test records."""
    _, teacher_token = teacher
    _, student_token = student

    # Teacher creates a test record
    resp = client.post(
        "/api/training/start",
        json={"case_id": test_case.id},
        headers=_auth_headers(teacher_token),
    )
    assert resp.status_code == 200
    test_record_id = resp.json()["record_id"]

    # Student creates a real record
    resp2 = client.post(
        "/api/training/start",
        json={"case_id": test_case.id},
        headers=_auth_headers(student_token),
    )
    assert resp2.status_code == 200
    real_record_id = resp2.json()["record_id"]

    # Complete both records
    for rid in [test_record_id, real_record_id]:
        record = db_session.query(TrainingRecord).filter(TrainingRecord.id == rid).first()
        record.status = "completed"
        record.end_time = datetime.now(UTC)
    db_session.commit()

    # Teacher stats (teacher_summary -> should only count student records)
    resp3 = client.get(
        "/api/stats/teacher-summary",
        headers=_auth_headers(teacher_token),
    )
    assert resp3.status_code == 200
    items = resp3.json()["items"]
    # Find the student in the summary
    student_user = student[0]
    student_item = next((s for s in items if s["user_id"] == student_user.id), None)
    assert student_item is not None
    assert student_item["total_sessions"] == 1  # Only the real (non-test) record

    # Teacher is not in student summary (is_test user should not appear)
    teacher_user = teacher[0]
    teacher_item = next((s for s in items if s["user_id"] == teacher_user.id), None)
    assert teacher_item is None or teacher_item["total_sessions"] == 0

    # get_stats (admin stats) should also exclude is_test
    resp4 = client.get(
        "/api/admin/stats",
        headers=_auth_headers(teacher_token),
    )
    assert resp4.status_code == 200
    stats = resp4.json()
    assert stats["total_records"] == 1  # Only the student's real record


def test_class_summary_excludes_is_test(
    client,
    teacher,
    student,
    test_case,
    test_class,
    test_student_in_class,
    db_session,
):
    """Class summary excludes is_test records."""
    _, teacher_token = teacher

    # Complete a real record for the student
    resp = client.post(
        "/api/training/start",
        json={"case_id": test_case.id},
        headers=_auth_headers(student[1]),
    )
    assert resp.status_code == 200
    rid = resp.json()["record_id"]
    record = db_session.query(TrainingRecord).filter(TrainingRecord.id == rid).first()
    record.status = "completed"
    record.end_time = datetime.now(UTC)
    db_session.commit()

    resp2 = client.get(
        "/api/stats/class-summary",
        headers=_auth_headers(teacher_token),
    )
    assert resp2.status_code == 200
    summaries = resp2.json()
    cls_summary = next((s for s in summaries if s["class_id"] == test_class.id), None)
    assert cls_summary is not None
    assert cls_summary["total_sessions"] == 1  # Only the real record, not any is_test


def test_assignment_detail_excludes_is_test(
    client,
    teacher,
    student,
    test_case,
    test_class,
    test_student_in_class,
    db_session,
):
    """Assignment detail excludes is_test records."""
    _, teacher_token = teacher

    from models.case_practice import Assignment, Practice

    practice = Practice(name="is_test_exclusion_test", description="", case_id=test_case.id, features={}, behavior={})
    db_session.add(practice)
    db_session.commit()
    db_session.refresh(practice)

    now = datetime.now(UTC)
    assignment = Assignment(
        practice_id=practice.id,
        class_id=test_class.id,
        teacher_id=teacher[0].id,
        title="is_test assignment",
        start_time=now,
        end_time=now + timedelta(days=7),
    )
    db_session.add(assignment)
    db_session.commit()
    db_session.refresh(assignment)

    # Create a test record (teacher) and a real record (student) for the assignment
    _record_teacher = TrainingRecord(
        user_id=teacher[0].id,
        case_id=test_case.id,
        practice_id=practice.id,
        assignment_id=assignment.id,
        status="completed",
        is_test=True,
        start_time=now,
        end_time=now + timedelta(minutes=10),
    )
    _record_student = TrainingRecord(
        user_id=student[0].id,
        case_id=test_case.id,
        practice_id=practice.id,
        assignment_id=assignment.id,
        status="completed",
        is_test=False,
        start_time=now,
        end_time=now + timedelta(minutes=15),
    )
    db_session.add_all([_record_teacher, _record_student])
    db_session.commit()

    resp = client.get(
        f"/api/assignments/{assignment.id}",
        headers=_auth_headers(teacher_token),
    )
    assert resp.status_code == 200
    detail = resp.json()
    # completed_count should only count non-test records
    assert detail["completed_count"] == 1
    # scored_count should only count non-test records
    assert detail["scored_count"] == 0

    # student list should only include the real student, not the teacher
    student_items = detail["students"]
    student_ids = [s["user_id"] for s in student_items]
    assert student[0].id in student_ids
    assert teacher[0].id not in student_ids


def test_is_test_exposed_in_brief_and_detail(
    client,
    teacher,
    student,
    test_case,
    db_session,
):
    """is_test is exposed in TrainingRecordBrief and TrainingRecordDetail."""
    _, teacher_token = teacher
    _, student_token = student

    resp = client.post(
        "/api/training/start",
        json={"case_id": test_case.id},
        headers=_auth_headers(teacher_token),
    )
    record_id = resp.json()["record_id"]

    # Check brief (in records list)
    resp2 = client.get(
        "/api/training/records?limit=100",
        headers=_auth_headers(teacher_token),
    )
    assert resp2.status_code == 200
    items = resp2.json()["items"]
    found = next((r for r in items if r["id"] == record_id), None)
    assert found is not None
    assert found["is_test"] is True

    # Check detail
    resp3 = client.get(
        f"/api/training/records/{record_id}",
        headers=_auth_headers(teacher_token),
    )
    assert resp3.status_code == 200
    detail = resp3.json()
    assert detail["is_test"] is True
