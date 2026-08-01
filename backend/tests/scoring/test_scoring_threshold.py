"""Tests for scoring — all training records produce scoring regardless of message count."""

from models import Message, TrainingRecord


def _start_training(client, token, case_id):
    resp = client.post(
        "/api/training/start",
        json={"case_id": case_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    return resp.json()["record_id"]


class TestEndTrainingThreshold:
    def test_two_short_messages_enqueues_normally(self, client, student, test_case, db_session):
        test_case.is_open = True
        db_session.commit()

        _user, token = student
        record_id = _start_training(client, token, test_case.id)

        msgs = [
            Message(record_id=record_id, role="student", content="hi"),
            Message(record_id=record_id, role="student", content="ok"),
        ]
        db_session.add_all(msgs)
        db_session.commit()

        resp = client.post(
            f"/api/training/{record_id}/end",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["scoring_status"] == "pending"

    def test_enough_messages_enqueues_normally(self, client, student, test_case, db_session):
        test_case.is_open = True
        db_session.commit()

        _user, token = student
        record_id = _start_training(client, token, test_case.id)

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

        resp = client.post(
            f"/api/training/{record_id}/end",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["scoring_status"] == "pending"
        assert "评分" in data["message"]


class TestRetryScoringThreshold:
    def test_retry_scoring_enough_messages_enqueues(self, client, student, test_case, db_session):
        test_case.is_open = True
        db_session.commit()

        _user, token = student
        record_id = _start_training(client, token, test_case.id)

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

        record = db_session.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        db_session.refresh(record)
        record.status = "completed"
        record.scoring_status = "failed"
        db_session.commit()

        resp = client.post(
            f"/api/training/{record_id}/retry-scoring",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["scoring_status"] == "pending"


import pytest

pytestmark = pytest.mark.integration
