"""护理记录评分注入测试：sheet_data → 评分 prompt"""

from types import SimpleNamespace
from typing import cast

from models import NursingRecord, TrainingRecord
from modules.training.scoring.engine import _build_history_messages, _load_nursing_record_text


class TestLoadNursingRecordText:
    def test_enabled_with_sheet_data_returns_formatted(self, db_session):
        record = TrainingRecord(id=1, user_id=1, case_id=1, training_type="history_taking")
        record.practice_snapshot = {"features": {"nursing_record": True, "emotion": True}}
        db_session.add(record)
        db_session.flush()
        db_session.add(
            NursingRecord(
                record_id=1,
                user_id=1,
                sheet_data={
                    "subjective": "患者诉胸闷",
                    "objective": "BP 130/80",
                    "assessment": "",
                    "plan": "卧床休息",
                    "evaluation": "",
                },
                status="draft",
            )
        )
        db_session.commit()
        text = _load_nursing_record_text(db_session, record)
        assert "SUBJECTIVE: 患者诉胸闷" in text
        assert "OBJECTIVE: BP 130/80" in text
        assert "PLAN: 卧床休息" in text
        assert "ASSESSMENT" not in text

    def test_enabled_without_record_returns_empty(self, db_session):
        record = TrainingRecord(id=2, user_id=1, case_id=1, training_type="history_taking")
        record.practice_snapshot = {"features": {"nursing_record": True}}
        db_session.add(record)
        db_session.commit()
        assert _load_nursing_record_text(db_session, record) == ""

    def test_disabled_returns_empty(self, db_session):
        record = TrainingRecord(id=3, user_id=1, case_id=1, training_type="history_taking")
        record.practice_snapshot = {"features": {"nursing_record": False}}
        db_session.add(record)
        db_session.add(
            NursingRecord(
                record_id=3,
                user_id=1,
                sheet_data={"subjective": "患者诉胸闷"},
                status="draft",
            )
        )
        db_session.commit()
        assert _load_nursing_record_text(db_session, record) == ""


class TestBuildHistoryMessagesInjection:
    def _build(self, db_session, nursing_record_text=""):
        record = cast("TrainingRecord", SimpleNamespace(runtime_state={}, id=99999))
        msgs, _exam, nr_text = _build_history_messages(
            db_session,
            record,
            "评分标准TEXT",
            "清单TEXT",
            "schemaTEXT",
            "对话TEXT",
            nursing_record_text=nursing_record_text,
        )
        return msgs, nr_text

    def test_appends_record_to_criteria(self, db_session):
        msgs, nr_text = self._build(db_session, "SUBJECTIVE: 患者诉胸闷")
        system = msgs[0]["content"]
        assert "## 学生提交的护理评估记录" in system
        assert "SUBJECTIVE: 患者诉胸闷" in system
        assert nr_text == "SUBJECTIVE: 患者诉胸闷"

    def test_empty_text_no_append(self, db_session):
        msgs, _ = self._build(db_session, "")
        system = msgs[0]["content"]
        assert "学生提交的护理评估记录" not in system
