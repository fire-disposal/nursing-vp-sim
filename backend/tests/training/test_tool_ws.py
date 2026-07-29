from models import TrainingRecord, TrainingToolRequest


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _enable_tools(test_case, db_session) -> None:
    case_data = dict(test_case.case_data)
    case_data["tools"] = {
        "physical_exam": {
            "vital_signs": {
                "heart_rate": "112",
                "blood_pressure": "180/110",
            }
        },
        "nursing_record": {"enabled": True},
    }
    test_case.case_data = case_data
    db_session.commit()


def _start(client, token: str, case_id: int) -> int:
    response = client.post(
        "/api/training/start",
        json={"case_id": case_id},
        headers=_headers(token),
    )
    assert response.status_code == 200
    return int(response.json()["record_id"])


def _install_realtime_hub(client) -> None:
    from infra.realtime_hub import RealtimeHub

    client.app.state.realtime_hub = RealtimeHub()


def test_tool_request_is_committed_and_idempotent(client, student, test_case, db_session):
    _enable_tools(test_case, db_session)
    _install_realtime_hub(client)
    _, token = student
    record_id = _start(client, token, test_case.id)
    request = {
        "type": "tool",
        "request_id": "exam-request-1",
        "record_id": record_id,
        "tool": "physical_exam",
        "action": "measure",
        "params": {"op_type": "hr"},
    }

    with client.websocket_connect(f"/api/training/ws?token={token}") as websocket:
        websocket.send_json(request)
        first = websocket.receive_json()
        websocket.send_json(request)
        second = websocket.receive_json()

    assert first["type"] == "tool:result"
    assert first["request_id"] == "exam-request-1"
    assert first["ok"] is True
    assert second == first

    db_session.expire_all()
    record = db_session.query(TrainingRecord).filter(TrainingRecord.id == record_id).one()
    assert len(record.runtime_state["exam_results"]) == 1
    assert (
        db_session.query(TrainingToolRequest)
        .filter(
            TrainingToolRequest.record_id == record_id,
            TrainingToolRequest.request_id == "exam-request-1",
        )
        .count()
        == 1
    )


def test_tool_request_rejects_other_students_record(client, student, teacher, test_case, db_session):
    _enable_tools(test_case, db_session)
    _install_realtime_hub(client)
    _, student_token = student
    _, teacher_token = teacher
    teacher_record_id = _start(client, teacher_token, test_case.id)

    with client.websocket_connect(f"/api/training/ws?token={student_token}") as websocket:
        websocket.send_json(
            {
                "type": "tool",
                "request_id": "unauthorized-request-1",
                "record_id": teacher_record_id,
                "tool": "nursing_record",
                "action": "load",
                "params": {},
            }
        )
        response = websocket.receive_json()

    assert response["type"] == "tool:error"
    assert response["request_id"] == "unauthorized-request-1"
    assert response["status_code"] == 403
    assert response["detail"] == "无权访问此训练记录"


def test_tool_mutation_rejects_completed_record(client, student, test_case, db_session):
    _enable_tools(test_case, db_session)
    _install_realtime_hub(client)
    _, token = student
    record_id = _start(client, token, test_case.id)
    record = db_session.query(TrainingRecord).filter(TrainingRecord.id == record_id).one()
    record.status = "completed"
    db_session.commit()

    with client.websocket_connect(f"/api/training/ws?token={token}") as websocket:
        websocket.send_json(
            {
                "type": "tool",
                "request_id": "completed-request-1",
                "record_id": record_id,
                "tool": "physical_exam",
                "action": "measure",
                "params": {"op_type": "hr"},
            }
        )
        response = websocket.receive_json()

    assert response["type"] == "tool:error"
    assert response["request_id"] == "completed-request-1"
    assert response["status_code"] == 400
    assert response["detail"] == "训练已结束，不能继续操作"
