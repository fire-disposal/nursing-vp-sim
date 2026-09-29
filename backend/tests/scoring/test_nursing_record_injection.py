"""护理评估评分注入测试：**只有已提交（冻结）版本** 进正式评分输入。

旧行为（已修）：无论 draft/submitted 一律注入 `sheet_data` —— 未提交的草稿
因此成为正式评分输入，等于承认「零提交也能被评分」。
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

from modules.training.scoring.engine import (
    _build_history_messages,
    _load_nursing_record_text,
)


def _mock_db(first: object | None = None) -> MagicMock:
    db = MagicMock()
    chain = db.query.return_value.filter.return_value
    chain.first.return_value = first
    chain.order_by.return_value.all.return_value = []
    return db


def _record(*activity_ids: str, disabled: tuple[str, ...] = ()) -> SimpleNamespace:
    """病例声明（case_snapshot.activities）+ 作业覆盖（practice_snapshot.features）。

    能力来自服务端解析，不再来自 features 里手写的键。
    """
    activities = {activity_id: {"config": {"enabled": True}} for activity_id in activity_ids}
    overrides = dict.fromkeys(disabled, False)
    practice = {"features": overrides} if overrides else {}
    return SimpleNamespace(
        id=1,
        case_snapshot={"activities": activities},
        practice_snapshot=practice,
    )


def _nursing(**overrides) -> SimpleNamespace:
    base = {
        "sheet_data": {
            "subjective": "患者诉胸闷",
            "objective": "BP 130/80",
            "assessment": "",
            "plan": "卧床休息",
            "evaluation": "",
        },
        "submitted_at": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


class TestSubmittedOnly:
    def test_submitted_version_is_injected(self):
        db = _mock_db(first=_nursing(submitted_at="2026-09-25T10:00:00+00:00"))
        text = _load_nursing_record_text(db, _record("nursing_record"))

        assert "SUBJECTIVE: 患者诉胸闷" in text
        assert "OBJECTIVE: BP 130/80" in text
        assert "PLAN: 卧床休息" in text
        assert "ASSESSMENT" not in text

    def test_draft_is_not_injected(self):
        """核心回归：未提交草稿不得进入评分证据。"""
        db = _mock_db(first=_nursing(submitted_at=None))
        assert _load_nursing_record_text(db, _record("nursing_record")) == ""

    def test_enabled_without_record_returns_empty(self):
        db = _mock_db(first=None)
        assert _load_nursing_record_text(db, _record("nursing_record")) == ""

    def test_disabled_returns_empty(self):
        db = _mock_db(first=_nursing(submitted_at="2026-09-25T10:00:00+00:00"))
        assert _load_nursing_record_text(db, _record("nursing_record", disabled=("nursing_record",))) == ""

    def test_submitted_but_blank_sheet_returns_empty(self):
        db = _mock_db(first=_nursing(sheet_data={}, submitted_at="2026-09-25T10:00:00+00:00"))
        assert _load_nursing_record_text(db, _record("nursing_record")) == ""


class TestBuildHistoryMessagesInjection:
    def _build(self, nursing_record_text: str = ""):
        db = _mock_db(first=None)  # no TrainingAction audit rows
        record = SimpleNamespace(runtime_state={}, id=99999)
        msgs, _exam, nr_text, actions = _build_history_messages(
            db,
            record,
            "评分标准TEXT",
            "清单TEXT",
            "schemaTEXT",
            "对话TEXT",
            nursing_record_text=nursing_record_text,
            task_boundary_text="任务边界TEXT",
        )
        return msgs, nr_text, actions

    def test_record_reaches_scoring_input(self):
        """已提交产物随评分输入送达模型（模板变量，不再拼接到 criteria 里）。"""
        msgs, nr_text, _actions = self._build("SUBJECTIVE: 患者诉胸闷")
        user = msgs[1]["content"]
        assert "SUBJECTIVE: 患者诉胸闷" in user
        assert nr_text == "SUBJECTIVE: 患者诉胸闷"

    def test_task_boundary_reaches_scoring_input(self):
        msgs, _nr, _actions = self._build("")
        system = msgs[0]["content"]
        assert "任务边界TEXT" in system

    def test_no_record_uses_explicit_placeholder(self):
        msgs, _nr, _actions = self._build("")
        user = msgs[1]["content"]
        assert "学生未提交护理评估记录" in user
