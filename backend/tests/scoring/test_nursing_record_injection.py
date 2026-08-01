"""护理记录评分注入测试：sheet_data → 评分 prompt（纯逻辑，mock db）"""

from types import SimpleNamespace
from unittest.mock import MagicMock

from modules.training.scoring.engine import _build_history_messages, _load_nursing_record_text


def _mock_db(first: object | None = None) -> MagicMock:
    db = MagicMock()
    chain = db.query.return_value.filter.return_value
    chain.first.return_value = first
    chain.order_by.return_value.all.return_value = []
    return db


def _record(features: dict) -> SimpleNamespace:
    return SimpleNamespace(id=1, practice_snapshot={"features": features})


class TestLoadNursingRecordText:
    def test_enabled_with_sheet_data_returns_formatted(self):
        db = _mock_db(
            first=SimpleNamespace(
                sheet_data={
                    "subjective": "患者诉胸闷",
                    "objective": "BP 130/80",
                    "assessment": "",
                    "plan": "卧床休息",
                    "evaluation": "",
                }
            )
        )
        text = _load_nursing_record_text(db, _record({"nursing_record": True, "emotion": True}))
        assert "SUBJECTIVE: 患者诉胸闷" in text
        assert "OBJECTIVE: BP 130/80" in text
        assert "PLAN: 卧床休息" in text
        assert "ASSESSMENT" not in text

    def test_enabled_without_record_returns_empty(self):
        db = _mock_db(first=None)
        assert _load_nursing_record_text(db, _record({"nursing_record": True})) == ""

    def test_disabled_returns_empty(self):
        db = _mock_db(first=None)
        assert _load_nursing_record_text(db, _record({"nursing_record": False})) == ""


class TestBuildHistoryMessagesInjection:
    def _build(self, nursing_record_text: str = ""):
        db = _mock_db(first=None)  # no TrainingAction audit rows
        record = SimpleNamespace(runtime_state={}, id=99999)
        msgs, _exam, nr_text = _build_history_messages(
            db,
            record,
            "评分标准TEXT",
            "清单TEXT",
            "schemaTEXT",
            "对话TEXT",
            nursing_record_text=nursing_record_text,
        )
        return msgs, nr_text

    def test_appends_record_to_criteria(self):
        msgs, nr_text = self._build("SUBJECTIVE: 患者诉胸闷")
        system = msgs[0]["content"]
        assert "## 学生提交的护理评估记录" in system
        assert "SUBJECTIVE: 患者诉胸闷" in system
        assert nr_text == "SUBJECTIVE: 患者诉胸闷"

    def test_empty_text_no_append(self):
        msgs, _ = self._build("")
        system = msgs[0]["content"]
        assert "学生提交的护理评估记录" not in system
