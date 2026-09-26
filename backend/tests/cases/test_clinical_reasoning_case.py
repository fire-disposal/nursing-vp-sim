"""临床判断训练（``workflow: "clinical_reasoning"``）病例的 authoring 契约。

docs/15 §十六：Clinical Judgment Drill 是独立 workflow，不是第二套聊天。本切片交付的是
**病例编写、发布门禁与目录投影**，不是学生工作区。因此这里的断言分三层：

1. 类型化内容 schema（结构错误保存即 422，不静默失效）；
2. 发布门禁（证据可达性 / 引用完整性 / 锚点覆盖，报作者可见的 JSON 路径）；
3. 产品状态投影（目录 label + ``runtime_ready``；训练入口 409 且**不创建记录**）。
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, cast
from unittest.mock import patch

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import get_current_user
from main import app

if TYPE_CHECKING:
    from fastapi import FastAPI

from models import (
    CASE_STATUS_DRAFT,
    CASE_STATUS_PUBLISHED,
    Assignment,
    AssignmentRecipient,
    Case,
    CaseRevision,
    Class,
    ClassMembership,
    Notification,
    Role,
    Score,
    TrainingRecord,
    User,
)
from models.school import legacy_grades_table
from modules.cases.gate import CaseNotPublishableError, validate_case_row
from modules.cases.router import _to_case_brief
from modules.cases.service import CaseService
from modules.cases.validator import CLINICAL_CONTENT_FIELDS, CLINICAL_REASONING_ID, validate_case
from modules.training.profile import CLINICAL_REASONING, HISTORY_TAKING
from modules.training.router.session import CODE_WORKFLOW_NOT_STARTABLE, _case_is_startable
from modules.training.workflows import workflow_for_case
from schemas.case_schema import assert_valid_case_data, validate_case_data

#: 一份**结构完整**的临床判断病例：术后低氧，关键证据（SpO2）需要主动获取。
CLINICAL_CASE: dict = {
    "name": "术后低氧病例",
    "description": "临床判断训练：术后低氧的识别与处理",
    "workflow": CLINICAL_REASONING_ID,
    "difficulty": 2,
    "time_limit": 30,
    "scenario": {
        "title": "术后低氧",
        "setting": "外科病房 · 术后 6 小时",
        "summary": "患者术后 6 小时主诉气促，未吸氧状态下 SpO2 下降。",
        "learner_brief": "在一条阶段链上完成评估、取证、判断、行动与沟通。",
    },
    "findings": [
        {
            "id": "f.spo2",
            "label": "SpO2 88%（未吸氧）",
            "kind": "vital_sign",
            "critical": True,
            "obtainable_via": ["exam:vital_signs"],
        },
        {"id": "f.crp", "label": "CRP 82 mg/L", "kind": "lab", "obtainable_via": ["lab:CBC+CRP"]},
        {"id": "f.sputum", "label": "痰液粘稠、量少", "kind": "observation"},
    ],
    "initial": {"visible_findings": ["f.sputum"], "hidden_findings": ["f.spo2", "f.crp"]},
    "progression": [
        {
            "id": "p.1",
            "trigger": {"kind": "time", "after_minutes": 5},
            "state_changes": {"spo2": 84},
            "description": "未吸氧 → 低氧加重",
        },
        {
            "id": "p.2",
            "trigger": {"kind": "finding", "ref": "f.spo2"},
            "state_changes": {"rr": 28},
            "description": "低氧确认后呼吸急促",
        },
    ],
    "objectives": {
        "must_notice": [{"id": "n.1", "label": "识别低氧", "finding": "f.spo2"}],
        "must_act": [{"id": "a.1", "label": "立即给氧", "action": "启动吸氧并复评 SpO2"}],
        "must_communicate": [{"id": "c.1", "label": "SBAR 报告医生", "cue": "SBAR 报告 SpO2 88% 与吸氧后复评结果"}],
    },
    "rubric": {
        "anchors": [
            {
                "id": "r.1",
                "label": "发现低氧（关键证据）",
                "rule": "objective_met",
                "weight": 2,
                "objectives": ["n.1"],
                "findings": ["f.spo2"],
            },
            {"id": "r.2", "label": "及时给氧", "rule": "action_taken", "weight": 3, "objectives": ["a.1"]},
            {"id": "r.3", "label": "沟通报告", "rule": "communicated", "weight": 2, "objectives": ["c.1"]},
        ]
    },
}

_SOURCE_TABLES = [
    legacy_grades_table,
    Role.__table__,
    User.__table__,
    Class.__table__,
    ClassMembership.__table__,
    Case.__table__,
    CaseRevision.__table__,
    Assignment.__table__,
    AssignmentRecipient.__table__,
    TrainingRecord.__table__,
    Score.__table__,
    Notification.__table__,
]


def _payload(**overrides) -> dict:
    """写路径入参：一次深拷贝，overrides 里给 ``None`` 表示删掉该键。"""
    data = json.loads(json.dumps(CLINICAL_CASE))
    for key, value in overrides.items():
        if value is None:
            data.pop(key, None)
        else:
            data[key] = value
    return data


def _errors(report) -> dict[str, list[str]]:
    grouped: dict[str, list[str]] = {}
    for issue in report.errors:
        grouped.setdefault(issue.field, []).append(issue.message)
    return grouped


def _sqlite_metadata() -> sa.MetaData:
    """SQLite 渲染不了 JSONB —— 复制元数据并把 JSONB 降级为 JSON（表名/列名不变）。"""
    meta = sa.MetaData()
    for table in _SOURCE_TABLES:
        table.to_metadata(meta)
    for table in meta.tables.values():
        for column in table.columns:
            if not isinstance(column.type, JSONB):
                continue
            column.type = sa.JSON()
            if column.server_default is not None and "::jsonb" in str(column.server_default.arg):
                column.server_default.arg = sa.text(str(column.server_default.arg).replace("::jsonb", ""))
    return meta


@pytest.fixture
def db():
    engine = sa.create_engine("sqlite://")
    _sqlite_metadata().create_all(engine)
    with Session(engine) as session:
        yield session


# ── 1. 类型化内容 schema ─────────────────────────────────────────────────


class TestClinicalContentSchema:
    def test_well_formed_payload_passes_and_round_trips_unchanged(self):
        """保存路径不得顺带改写内容：模型 dump 与原载荷逐键一致。"""
        assert bool(assert_valid_case_data(_payload()))
        assert validate_case_data(_payload(), strict=True) == _payload()

    def test_unknown_inner_key_is_rejected(self):
        """临床面是新键：拼错子键必须保存即 422，而不是静默失效（发布时才发现）。"""
        data = _payload()
        data["findings"][0]["availability"] = "always"  # 正确键是 obtainable_via
        with pytest.raises(ValidationError):
            assert_valid_case_data(data)

    def test_unknown_kind_is_rejected(self):
        data = _payload()
        data["findings"][0]["kind"] = "telepathy"
        with pytest.raises(ValidationError):
            assert_valid_case_data(data)

    def test_id_with_whitespace_is_rejected(self):
        data = _payload()
        data["objectives"]["must_act"][0]["id"] = "a 1"
        with pytest.raises(ValidationError):
            assert_valid_case_data(data)

    def test_non_positive_weight_is_rejected(self):
        data = _payload()
        data["rubric"]["anchors"][0]["weight"] = 0
        with pytest.raises(ValidationError):
            assert_valid_case_data(data)

    def test_history_taking_payload_is_unaffected(self):
        """问诊病例不带临床键时，schema 不注入任何新键（exclude_unset 语义不变）。"""
        data = {"name": "问诊病例", "chief_complaint": "咳嗽三天"}
        assert validate_case_data(data, strict=True) == data
        assert not [key for key in CLINICAL_CONTENT_FIELDS if key in validate_case_data(data, strict=True)]

    def test_legacy_read_path_still_passes_raw_through(self):
        """放宽读（strict=False）遇到坏临床内容仍返回原载荷：存量行不能因校验而 500。"""
        data = _payload()
        data["findings"] = "not-a-list"
        assert validate_case_data(data, strict=False) == data


# ── 2. 发布门禁 ───────────────────────────────────────────────────────────


class TestClinicalPublishGate:
    def test_well_formed_case_passes_the_gate(self):
        report = validate_case(_payload())
        assert report.errors == []
        assert report.warnings == []

    def test_missing_scenario(self):
        assert list(_errors(validate_case(_payload(scenario=None)))) == ["scenario"]

    def test_missing_findings(self):
        assert "findings" in _errors(validate_case(_payload(findings=None)))

    def test_empty_finding_catalog_is_rejected(self):
        assert "findings" in _errors(validate_case(_payload(findings=[])))

    def test_critical_evidence_without_any_acquisition_path(self):
        """关键证据既不可见也不可获取 = 学生永远拿不到 —— 必须发布前拦下。"""
        data = _payload(
            findings=[*_payload()["findings"], {"id": "f.abg", "label": "ABG pH 7.28", "kind": "lab", "critical": True}]
        )
        grouped = _errors(validate_case(data))
        assert "findings[3]" in grouped
        assert "关键证据" in grouped["findings[3]"][0]

    def test_hidden_evidence_without_obtainable_via(self):
        data = _payload()
        data["findings"][1].pop("obtainable_via")
        assert list(_errors(validate_case(data))) == ["findings[1].obtainable_via"]

    def test_evidence_listed_as_visible_and_hidden_at_once(self):
        data = _payload()
        data["initial"]["hidden_findings"] = ["f.spo2", "f.crp", "f.sputum"]
        assert "initial.hidden_findings" in _errors(validate_case(data))

    def test_must_notice_referencing_unknown_finding(self):
        data = _payload()
        data["objectives"]["must_notice"][0]["finding"] = "f.typo"
        assert "objectives.must_notice[0].finding" in _errors(validate_case(data))

    def test_empty_must_action_is_rejected(self):
        data = _payload()
        data["objectives"]["must_act"][0]["action"] = "   "
        assert list(_errors(validate_case(data))) == ["objectives.must_act[0].action"]

    def test_empty_communication_cue_is_rejected(self):
        data = _payload()
        data["objectives"]["must_communicate"][0]["cue"] = ""
        assert list(_errors(validate_case(data))) == ["objectives.must_communicate[0].cue"]

    def test_empty_objective_group_is_rejected(self):
        data = _payload()
        data["objectives"]["must_notice"] = []
        grouped = _errors(validate_case(data))
        assert "objectives.must_notice" in grouped

    def test_missing_objectives_is_rejected(self):
        assert "objectives" in _errors(validate_case(_payload(objectives=None)))

    def test_duplicate_ids_are_rejected(self):
        data = _payload()
        data["objectives"]["must_act"][0]["id"] = "n.1"
        assert "objectives.must_act[0].id" in _errors(validate_case(data))

    def test_invalid_progression_trigger_kind(self):
        data = _payload(progression=[{"id": "p.9", "trigger": {"kind": "vibes"}, "state_changes": {"spo2": 84}}])
        assert list(_errors(validate_case(data))) == ["progression[0].trigger.kind"]

    def test_time_trigger_without_after_minutes(self):
        data = _payload(progression=[{"id": "p.9", "trigger": {"kind": "time"}, "state_changes": {"spo2": 84}}])
        assert list(_errors(validate_case(data))) == ["progression[0].trigger.after_minutes"]

    def test_progression_referencing_unknown_finding(self):
        data = _payload(
            progression=[{"id": "p.9", "trigger": {"kind": "finding", "ref": "f.typo"}, "state_changes": {"spo2": 84}}]
        )
        assert list(_errors(validate_case(data))) == ["progression[0].trigger.ref"]

    def test_progression_referencing_unknown_objective(self):
        data = _payload(
            progression=[
                {"id": "p.9", "trigger": {"kind": "objective", "ref": "n.typo"}, "state_changes": {"spo2": 84}}
            ]
        )
        assert list(_errors(validate_case(data))) == ["progression[0].trigger.ref"]

    def test_progression_without_state_changes(self):
        data = _payload(
            progression=[{"id": "p.9", "trigger": {"kind": "time", "after_minutes": 3}, "state_changes": {}}]
        )
        assert list(_errors(validate_case(data))) == ["progression[0].state_changes"]

    def test_missing_progression_is_a_warning_not_an_error(self):
        """静态病例（学生不作为时状态不变）是合法设计，但必须被看见。"""
        report = validate_case(_payload(progression=None))
        assert report.errors == []
        assert [i.field for i in report.warnings] == ["progression"]

    def test_missing_rubric_anchors(self):
        assert "rubric.anchors" in _errors(validate_case(_payload(rubric={"anchors": []})))
        assert "rubric.anchors" in _errors(validate_case(_payload(rubric=None)))

    def test_rubric_anchor_referencing_unknown_objective(self):
        data = _payload()
        data["rubric"]["anchors"][0]["objectives"] = ["n.typo"]
        grouped = _errors(validate_case(data))
        assert "rubric.anchors[0].objectives[0]" in grouped

    def test_rubric_anchor_referencing_unknown_finding(self):
        data = _payload()
        data["rubric"]["anchors"][0]["findings"] = ["f.typo"]
        assert "rubric.anchors[0].findings[0]" in _errors(validate_case(data))

    def test_rubric_rule_contradicting_the_objective_group(self):
        """``action_taken`` 只判定 must_act；指向 must_notice 的目标是自相矛盾的锚点。"""
        data = _payload()
        data["rubric"]["anchors"][1]["objectives"] = ["n.1"]
        assert any("矛盾" in message for messages in _errors(validate_case(data)).values() for message in messages)

    def test_objective_without_any_anchor_is_rejected(self):
        data = _payload()
        data["objectives"]["must_act"].append({"id": "a.2", "label": "复查血气", "action": "复查 ABG"})
        grouped = _errors(validate_case(data))
        assert "objectives.must_act[1]" in grouped
        assert "没有任何 rubric 锚点" in grouped["objectives.must_act[1]"][0]

    def test_activities_declaration_is_rejected_while_no_activity_is_ready(self):
        data = _payload(activities={"quiz": {"config": {"questions": [{"id": "q1"}]}}})
        assert "activities" in _errors(validate_case(data))

    def test_clinical_content_without_declaration_is_rejected(self):
        """未声明的临床内容会被当成问诊病例 —— 学生将进入无可渲染内容的工作区。"""
        data = _payload(workflow=None)
        report = validate_case(data)
        grouped = _errors(report)
        assert "workflow" in grouped
        hints = [i.fix_hint for i in report.errors if i.field == "workflow"]
        assert any(CLINICAL_REASONING_ID in hint for hint in hints)

    def test_clinical_content_declared_as_history_taking_is_rejected(self):
        data = _payload(workflow="history_taking")
        assert "workflow" in _errors(validate_case(data))

    def test_unknown_workflow_declaration_is_still_rejected_here(self):
        data = _payload(workflow="reasoning_drill")
        assert "workflow" in _errors(validate_case(data))


class TestHistoryTakingGateRegression:
    def test_question_case_keeps_its_own_rules(self):
        """问诊病例仍走问诊规则：临床判断的六个面不参与它的判定。"""
        data = {
            "name": "问诊病例",
            "patient_info": {"name": "张三", "age": 40, "gender": "男"},
            "example_dialogues": [
                {"q": "哪不舒服", "a": "咳嗽"},
                {"q": "多久了", "a": "三天"},
                {"q": "有痰吗", "a": "有"},
            ],
            "activities": {"physical_exam": {"config": {"vital_signs": {"temp": "36.5-37.2"}}}},
        }
        report = validate_case(data)
        assert report.errors == []


# ── 3. 目录投影与产品状态 ─────────────────────────────────────────────────


def _published_case(content: dict, *, case_id: int = 41) -> Case:
    case = Case(name=content.get("name", "病例"), description="", difficulty=2, time_limit_minutes=30)
    case.id = case_id
    case.status = CASE_STATUS_PUBLISHED
    case.is_open = True
    case.case_data = content
    case.current_revision_id = 7
    return case


class TestCatalogProjection:
    def test_clinical_case_is_labelled_and_flagged_not_startable(self):
        brief = _to_case_brief(_published_case(_payload()))
        assert brief.workflow is not None
        assert brief.workflow.id == CLINICAL_REASONING_ID
        assert brief.workflow.label == CLINICAL_REASONING.label
        assert brief.workflow.runtime_ready is False
        # 运行期未就绪的 workflow 不投影任何能力（目录不得承诺开不了训练的能力）
        assert brief.capabilities == {}

    def test_history_taking_case_keeps_its_projection(self):
        content = {
            "activities": {"physical_exam": {"config": {"vital_signs": {"temp": "39.0"}}}},
            "patient_info": {"name": "张三", "age": 40, "gender": "男"},
        }
        brief = _to_case_brief(_published_case(content))
        assert brief.workflow is not None
        assert (brief.workflow.id, brief.workflow.label, brief.workflow.runtime_ready) == (
            HISTORY_TAKING.id,
            HISTORY_TAKING.label,
            True,
        )
        assert brief.capabilities.get("physical_exam") is True


# ── 4. 教师发布流程（真实 service + revision 落地）────────────────────────


def _created(db: Session, **overrides) -> Case:
    CaseService(db).create(_payload(**overrides), user_id=1, user_role="admin")
    return db.query(Case).order_by(Case.id.desc()).first()


class TestPublishFlow:
    def test_teacher_can_create_validate_and_publish(self, db: Session):
        case = _created(db)

        assert case.status == CASE_STATUS_DRAFT
        preview = validate_case_row(case)
        assert preview.errors == []

        view, report = CaseService(db).publish(case.id, user_id=1, user_role="admin")

        assert report.errors == []
        assert view.status == CASE_STATUS_PUBLISHED
        revision = db.get(CaseRevision, case.current_revision_id)
        assert revision is not None
        # 训练入口按 revision 解析：声明的 workflow 落在冻结内容里
        assert revision.content["workflow"] == CLINICAL_REASONING_ID
        assert workflow_for_case(case) is CLINICAL_REASONING

    def test_invalid_clinical_case_is_blocked_with_author_visible_paths(self, db: Session):
        data = _payload()
        data["initial"]["hidden_findings"] = ["f.crp", "f.sputum"]  # 关键证据 f.spo2 无人可拿
        data["rubric"]["anchors"][2]["objectives"] = ["c.typo"]  # 悬空锚点引用
        case = _created(db, **data)

        with pytest.raises(CaseNotPublishableError) as excinfo:
            CaseService(db).publish(case.id, user_id=1, user_role="admin")

        fields = {issue.field for issue in excinfo.value.report.errors}
        assert {"findings[0]", "rubric.anchors[2].objectives[0]"} <= fields
        db.rollback()
        assert case.status == CASE_STATUS_DRAFT
        assert db.query(CaseRevision).count() == 0

    def test_structurally_invalid_declaration_is_blocked_at_save_time(self, db: Session):
        """结构错误（空 action / 未知 kind）连保存都过不去：422 + pydantic 路径，不必等发布。"""
        data = _payload()
        data["objectives"]["must_act"][0]["action"] = ""
        with pytest.raises(ValidationError) as excinfo:
            CaseService(db).create(data, user_id=1, user_role="admin")
        assert "objectives.must_act.0.action" in str(excinfo.value)
        assert db.query(Case).count() == 0

    def test_published_case_edit_is_gated_and_content_stays_frozen(self, db: Session):
        case = _created(db)
        CaseService(db).publish(case.id, user_id=1, user_role="admin")
        first_revision_id = case.current_revision_id
        frozen = json.loads(json.dumps(case.case_data))

        broken = _payload()
        broken["rubric"]["anchors"][0]["objectives"] = ["n.typo"]
        with pytest.raises(CaseNotPublishableError):
            CaseService(db).update(case.id, broken, user_id=1, user_role="admin")

        db.rollback()
        assert case.case_data == frozen
        assert case.current_revision_id == first_revision_id
        assert db.query(CaseRevision).count() == 1


# ── 5. 训练入口：产品状态冲突，不落地空记录 ──────────────────────────────


class _StubQuery:
    """最小查询替身：只回答 start 在拒绝之前会问的问题。"""

    def __init__(self, value):
        self._value = value

    def filter(self, *_a, **_k):
        return self

    def options(self, *_a, **_k):
        return self

    def order_by(self, *_a, **_k):
        return self

    def with_for_update(self):
        return self

    def first(self):
        return self._value

    def all(self):
        return [self._value] if self._value is not None else []


class _StubSession:
    """只回答 ``POST /api/training/start`` 在解析 workflow 之前会问的问题。"""

    def __init__(self, case: Case, revision: CaseRevision):
        self.case = case
        self.revision = revision
        self.added: list = []

    def query(self, model):
        name = getattr(model, "__name__", "")
        if name == "Case":
            return _StubQuery(self.case)
        if name == "TrainingRecord":
            return _StubQuery(None)
        if name == "User":
            return _StubQuery(None)
        return _StubQuery(None)

    def get(self, model, _pk):
        return self.revision if getattr(model, "__name__", "") == "CaseRevision" else None

    def add(self, obj):
        self.added.append(obj)


class _FakeStudent:
    id = 1
    display_name = "测试学生"

    def has_permission(self, _permission: str) -> bool:
        return True


def _start_response(db: _StubSession, case_id: int):
    """用依赖覆盖跑一次真实的 ``POST /api/training/start``。

    用 ``patch.dict`` 而不是 ``dependency_overrides.clear()``：其他测试模块在 import 期就装了
    全局覆盖（如 ``tests/simulations/test_api_flow.py``），清空会把它们一起抹掉。
    """

    def _override_db():
        yield db

    overrides = {get_db: _override_db, get_current_user: lambda: _FakeStudent()}
    with patch.dict(app.dependency_overrides, overrides):
        return TestClient(cast("FastAPI", app)).post("/api/training/start", json={"case_id": case_id})


def test_start_endpoint_rejects_clinical_reasoning_without_creating_a_record():
    """学生入口的产品状态冲突：409 + 机器可读码 + 身份；绝不落地一条空训练记录。"""
    case = _published_case(_payload())
    revision = CaseRevision(id=7, case_id=case.id or 0, revision_no=1, content={"workflow": CLINICAL_REASONING_ID})
    db = _StubSession(case, revision)

    response = _start_response(db, case.id or 0)

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == CODE_WORKFLOW_NOT_STARTABLE
    assert detail["workflow"] == {"id": CLINICAL_REASONING_ID, "label": CLINICAL_REASONING.label}
    assert "不能开始训练" in detail["message"]
    assert db.added == []


def test_blind_box_random_pool_excludes_workflows_without_a_runtime_surface():
    clinical = _published_case(_payload())
    clinical.id = 41
    assert _case_is_startable(clinical) is False

    history = _published_case({"activities": {"nursing_record": {"config": True}}})
    history.id = 42
    assert _case_is_startable(history) is True
