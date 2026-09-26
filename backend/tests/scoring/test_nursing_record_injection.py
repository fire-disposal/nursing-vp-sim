"""护理评估评分注入测试：**只有已提交（冻结）版本** + 结构化护理诊断进评分证据。

旧行为（已修）：无论 draft/submitted 一律注入 `sheet_data` —— 未提交的草稿
因此成为正式评分输入，等于承认「零提交也能被评分」。
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

from modules.training.scoring.engine import (
    _build_history_messages,
    _format_nursing_diagnoses,
    _load_nursing_record_text,
)


def _mock_db(first: object | None = None) -> MagicMock:
    db = MagicMock()
    chain = db.query.return_value.filter.return_value
    chain.first.return_value = first
    chain.order_by.return_value.all.return_value = []
    return db


def _record(*activity_ids: str, runtime_state: dict | None = None, disabled: tuple[str, ...] = ()) -> SimpleNamespace:
    """病例声明（case_snapshot.activities）+ 作业覆盖（practice_snapshot.features）。

    能力来自服务端解析，不再来自 features 里手写的键（docs/15 §四）。
    """
    activities = {activity_id: {"config": {"enabled": True}} for activity_id in activity_ids}
    overrides = dict.fromkeys(disabled, False)
    practice = {"features": overrides} if overrides else {}
    return SimpleNamespace(
        id=1,
        case_snapshot={"activities": activities},
        practice_snapshot=practice,
        runtime_state=runtime_state,
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


_DIAGNOSES = [
    {
        "problem": "气体交换受损",
        "related_factors": ["痰液粘稠/过多"],
        "defining_characteristics": ["异常呼吸音", "SaO2下降"],
        "priority": 0,
    },
    {"problem": "焦虑", "related_factors": [], "defining_characteristics": ["情绪改变"], "priority": 1},
]


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


class TestStructuredDiagnoses:
    def test_format_includes_factors_characteristics_and_order(self):
        text = _format_nursing_diagnoses(_record("nursing_diagnosis", runtime_state={"nursing_diagnoses": _DIAGNOSES}))

        assert "1. 气体交换受损" in text
        assert "相关因素：痰液粘稠/过多" in text
        assert "定义特征：异常呼吸音、SaO2下降" in text
        assert text.index("气体交换受损") < text.index("焦虑")

    def test_missing_fields_are_marked_not_dropped(self):
        text = _format_nursing_diagnoses(_record("nursing_diagnosis", runtime_state={"nursing_diagnoses": _DIAGNOSES}))
        assert "相关因素：未填写" in text

    def test_no_diagnoses_returns_empty(self):
        assert _format_nursing_diagnoses(_record("nursing_diagnosis", runtime_state={})) == ""

    def test_diagnoses_are_merged_into_evidence_without_record(self):
        """诊断是独立 Activity 产物：没有已提交记录时它自己也是证据。"""
        db = _mock_db(first=None)
        record = _record(
            "nursing_record",
            "nursing_diagnosis",
            runtime_state={"nursing_diagnoses": _DIAGNOSES},
        )
        text = _load_nursing_record_text(db, record)
        assert "气体交换受损" in text

    def test_diagnoses_ignored_when_activity_disabled(self):
        db = _mock_db(first=_nursing(submitted_at="2026-09-25T10:00:00+00:00"))
        record = _record(
            "nursing_record",
            "nursing_diagnosis",
            runtime_state={"nursing_diagnoses": _DIAGNOSES},
            disabled=("nursing_diagnosis",),
        )
        text = _load_nursing_record_text(db, record)
        assert "气体交换受损" not in text
        assert "SUBJECTIVE: 患者诉胸闷" in text


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
