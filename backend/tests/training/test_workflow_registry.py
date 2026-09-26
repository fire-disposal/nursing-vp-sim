"""Workflow 判别契约 —— 病例决定 / 记录冻结 / 读取一律走解析器（docs/15 §二、§九、§十六）。

Slice 0 把「这次训练跑哪条 workflow」从代码常量搬到**病例 revision 决定 → 训练记录冻结**
（``training_records.workflow_id``，NOT NULL）；Slice 1 登记了第二条闭包
``clinical_reasoning``，但它是**仅作者面就绪**（``runtime_ready=False``）—— 可编写/发布/编目，
不能开始训练。

守住五件事：

1. **冻结语义**：运行期读取跟随记录的 ``workflow_id``，不跟随代码常量（登记第二条
   workflow 后，老记录仍然跑它自己那条闭包）；
2. **未知 workflow 拒绝**：未登记的 id、以及「登记了多条**可开始**的闭包但病例/记录没说明」
   一律报错，绝不静默回落到第一条（否则新 workflow 的病例会跑成问诊）；
3. **产品状态门**：运行期未就绪的闭包可以解析（编写/发布/目录要用），但
   ``require_startable`` 一律拒绝开始 —— 登记 ≠ 可以开始；
4. **history_taking 回归**：现有问诊路径的 features / manifest / 病例门禁输出逐字节不变；
5. **迁移契约**：判别列 NOT NULL、存量行回填 ``history_taking``、迁移链单 head。
"""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest
import sqlalchemy as sa
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from core.statuses import TrainingStatus
from models import Assignment, Case, CaseRevision, Class, Role, TrainingRecord, User
from models.school import legacy_grades_table
from modules.cases.validator import validate_case
from modules.training import workflows
from modules.training.manifest import build_session_manifest
from modules.training.profile import CLINICAL_REASONING, HISTORY_TAKING, CompletionPolicy
from modules.training.workflows import (
    CASE_WORKFLOW_FIELD,
    DEFAULT_WORKFLOW_ID,
    UnknownWorkflowError,
    WorkflowNotStartableError,
    declared_workflow_id,
    get_workflow,
    record_activity_available,
    registered_workflow_ids,
    require_startable,
    startable_workflow_ids,
    workflow_for_case,
    workflow_for_case_data,
    workflow_for_case_revision,
    workflow_for_record,
)
from schemas.training import TrainingStartRequest

_CASE_DATA = {
    "activities": {
        "physical_exam": {"config": {"vital_signs": {"temperature": "39.0"}}},
        "nursing_record": {"config": True},
    }
}

#: 同时声明 quiz 与护理评估：用来验证「记录的闭包决定哪项可用」
_CASE_WITH_QUIZ = {
    "activities": {
        "quiz": {"config": {"questions": [{"id": "q1"}]}},
        "nursing_record": {"config": True},
    }
}

#: 未来的第三条**可开始**闭包（本切片不登记）：只用于验证「读取跟随记录」与
#: 「登记第二条可开始的闭包后必须显式声明」而不引入生产入口
_FAKE_WORKFLOW = replace(
    HISTORY_TAKING,
    id="reasoning_drill",
    label="临床判断训练",
    activities=("quiz",),
    completion=CompletionPolicy(required_artifacts=()),
)


@pytest.fixture
def two_workflows(monkeypatch) -> None:
    """把第二条 workflow 临时登记进注册表（monkeypatch 自动还原，不进生产导航）。"""
    monkeypatch.setitem(workflows.REGISTRY, _FAKE_WORKFLOW.id, _FAKE_WORKFLOW)


@pytest.fixture
def db() -> Session:
    """SQLite 上复制一份元数据（JSONB → JSON）跑真实 ORM/DDL 路径。"""
    meta = sa.MetaData()
    for table in (
        legacy_grades_table,
        Role.__table__,
        User.__table__,
        Class.__table__,
        Case.__table__,
        CaseRevision.__table__,
        Assignment.__table__,
        TrainingRecord.__table__,
    ):
        table.to_metadata(meta)
    for table in meta.tables.values():
        for column in table.columns:
            if not isinstance(column.type, JSONB):
                continue
            column.type = sa.JSON()
            if column.server_default is not None and "::jsonb" in str(column.server_default.arg):
                column.server_default.arg = sa.text(str(column.server_default.arg).replace("::jsonb", ""))
    engine = sa.create_engine("sqlite://")
    meta.create_all(engine)
    with Session(engine) as session:
        yield session


def _seed_student_and_case(db: Session) -> tuple[User, Case]:
    role = Role(name="student", display_name="学生", is_system=True)
    db.add(role)
    db.flush()
    user = User(username="wf-student", password_hash="x", display_name="学生", role_id=role.id)
    case = Case(name="契约病例", description="", difficulty=1, time_limit_minutes=30)
    db.add_all([user, case])
    db.flush()
    return user, case


# ── 注册表与解析 ──────────────────────────────────────────────────────────


class TestRegistry:
    def test_production_registry_registers_clinical_reasoning_without_runtime_surface(self):
        """``clinical_reasoning`` 已登记，但**没有运行期入口**：可编写/发布/编目，不能开始。

        这条断言守的是产品状态：登记 ≠ 可以开始（docs/15 §十六）。缺了 ``runtime_ready``
        或给它 ``activities``/``prompts``，就等于谎称学生工作区已经存在。
        """
        assert registered_workflow_ids() == ("history_taking", "clinical_reasoning")
        assert workflows.REGISTRY["clinical_reasoning"] is CLINICAL_REASONING

        drill = workflows.REGISTRY["clinical_reasoning"]
        assert drill.runtime_ready is False
        assert HISTORY_TAKING.runtime_ready is True
        assert startable_workflow_ids() == ("history_taking",)
        # 没有已就绪的 Activity / 产物 / 患者对话 prompt / 护理评分 rubric
        assert drill.activities == ()
        assert drill.artifact_kinds == ()
        assert drill.completion.required_artifacts == ()
        assert drill.prompts.system == ""
        assert drill.prompts.dynamic == ""
        assert drill.rubric == {}
        assert drill.note_sources == []

    def test_registry_entries_are_enumerable_and_self_consistent(self):
        assert set(workflows.REGISTRY) == set(registered_workflow_ids())
        for workflow_id, definition in workflows.REGISTRY.items():
            assert definition.id == workflow_id
            assert definition.label
        # 可开始集合是登记表的子集，且只由 runtime_ready 决定
        assert set(startable_workflow_ids()) <= set(registered_workflow_ids())
        assert set(startable_workflow_ids()) == {
            workflow_id for workflow_id, definition in workflows.REGISTRY.items() if definition.runtime_ready
        }

    def test_require_startable_rejects_workflows_without_a_runtime_surface(self):
        assert require_startable(HISTORY_TAKING) is HISTORY_TAKING
        with pytest.raises(WorkflowNotStartableError) as excinfo:
            require_startable(CLINICAL_REASONING)
        assert excinfo.value.workflow_id == "clinical_reasoning"
        assert "临床判断训练" in str(excinfo.value)


class TestUnknownWorkflowRejected:
    def test_unregistered_id_is_rejected(self):
        with pytest.raises(UnknownWorkflowError) as excinfo:
            get_workflow("reasoning_drill")
        assert excinfo.value.workflow_id == "reasoning_drill"
        assert "history_taking" in str(excinfo.value)

    @pytest.mark.parametrize("value", [None, "", "  ", 123, {"id": "history_taking"}, ["history_taking"]])
    def test_non_string_or_empty_id_is_rejected(self, value):
        with pytest.raises(UnknownWorkflowError):
            get_workflow(value)

    def test_case_declaring_unregistered_workflow_is_rejected(self):
        with pytest.raises(UnknownWorkflowError):
            workflow_for_case_data({"workflow": "reasoning_drill"})

    def test_record_with_unregistered_frozen_workflow_is_rejected(self):
        record = TrainingRecord(workflow_id="reasoning_drill", case_snapshot=_CASE_DATA)
        with pytest.raises(UnknownWorkflowError):
            workflow_for_record(record)

    def test_undeclared_case_is_rejected_once_second_startable_workflow_exists(self, two_workflows):
        """登记第二条**可开始**的 workflow 后，病例不再允许「不声明」——否则会静默跑成第一条。"""
        with pytest.raises(UnknownWorkflowError):
            workflow_for_case_data({})
        with pytest.raises(UnknownWorkflowError):
            workflow_for_case_data({"workflow": 123})

    def test_record_without_frozen_id_is_rejected_once_second_startable_workflow_exists(self, two_workflows):
        with pytest.raises(UnknownWorkflowError):
            workflow_for_record(TrainingRecord(case_snapshot=_CASE_DATA))

    def test_registered_but_not_startable_workflow_does_not_tighten_declaration(self):
        """``clinical_reasoning`` 已登记，但只有一条**可开始**的闭包 —— 省略声明仍然合法。

        收紧判据是「可开始的 workflow 有几条」，不是「登记了几条」：不可开始的闭包不可能被
        省略选中（它根本开不了训练）。这条规则一变，全库存量病例会在一夜之间解析失败。
        """
        assert len(registered_workflow_ids()) > 1
        assert startable_workflow_ids() == ("history_taking",)
        assert workflow_for_case_data(dict(_CASE_DATA)) is HISTORY_TAKING
        assert workflow_for_case_data({}) is HISTORY_TAKING

    def test_declared_clinical_reasoning_resolves_for_authoring_paths(self):
        """声明 clinical_reasoning 的病例可解析（编写/发布/目录要用），但不可开始。"""
        workflow = workflow_for_case_data({"workflow": "clinical_reasoning"})
        assert workflow is CLINICAL_REASONING
        with pytest.raises(WorkflowNotStartableError):
            require_startable(workflow)
        # 解析成功 ≠ 记录可冻结：训练入口在解析后立刻过 require_startable（见 router/session）
        record = TrainingRecord(workflow_id="clinical_reasoning", case_snapshot=_CASE_DATA)
        with pytest.raises(WorkflowNotStartableError):
            require_startable(workflow_for_record(record))


class TestCaseRevisionDecides:
    def test_revision_declaration_decides(self, two_workflows):
        revision = CaseRevision(content={"workflow": _FAKE_WORKFLOW.id})
        assert workflow_for_case_revision(revision).id == _FAKE_WORKFLOW.id

    def test_revision_without_declaration_uses_the_only_workflow(self):
        revision = CaseRevision(content=dict(_CASE_DATA))
        assert workflow_for_case_revision(revision) is HISTORY_TAKING

    def test_declared_id_is_trimmed(self):
        assert declared_workflow_id({CASE_WORKFLOW_FIELD: "  history_taking  "}) == "history_taking"
        assert declared_workflow_id({CASE_WORKFLOW_FIELD: ""}) is None
        assert declared_workflow_id(None) is None

    def test_case_catalog_resolution_prefers_current_revision(self, two_workflows):
        """目录投影按 current revision 解析；未发布病例才落到工作副本。"""
        case = Case(
            name="契约病例",
            case_data={"workflow": "history_taking", **_CASE_DATA},
            current_revision=CaseRevision(case_id=1, revision_no=1, content={"workflow": _FAKE_WORKFLOW.id}),
        )
        assert workflow_for_case(case).id == _FAKE_WORKFLOW.id

        draft = Case(name="草稿病例", case_data={"workflow": _FAKE_WORKFLOW.id}, current_revision=None)
        assert workflow_for_case(draft).id == _FAKE_WORKFLOW.id

    def test_client_cannot_select_workflow(self):
        """请求体不接受 workflow：多传即 422（``_REQ_CFG`` extra=forbid）。"""
        assert CASE_WORKFLOW_FIELD not in TrainingStartRequest.model_fields
        with pytest.raises(PydanticValidationError):
            TrainingStartRequest.model_validate({"case_id": 1, "workflow": "clinical_reasoning"})
        # 现有合法请求体不受影响
        assert TrainingStartRequest.model_validate({"case_id": 1}).case_id == 1


class TestFreezeSemantics:
    def test_reads_follow_the_frozen_record_workflow(self, two_workflows):
        """记录冻结哪条，运行期就读哪条（manifest/可用性/能力投影同一入口）。"""
        record = TrainingRecord(
            user_id=1,
            case_id=1,
            workflow_id=_FAKE_WORKFLOW.id,
            case_snapshot=_CASE_WITH_QUIZ,
            practice_snapshot={"features": {}},
        )

        workflow = workflow_for_record(record)
        assert workflow is _FAKE_WORKFLOW

        manifest = build_session_manifest(
            session_id=1,
            status=TrainingStatus.IN_PROGRESS,
            revision=0,
            case_data=_CASE_WITH_QUIZ,
            workflow=workflow,
            case_id=1,
        )
        assert manifest["workflow"]["id"] == _FAKE_WORKFLOW.id
        assert manifest["workflow"]["label"] == _FAKE_WORKFLOW.label
        assert {item["id"] for item in manifest["activities"]} == {"quiz"}
        # 可用性门也按记录的闭包判定（nursing_record 不在 fake 的白名单里）
        assert record_activity_available(record, "nursing_record") is False
        assert record_activity_available(record, "quiz") is True

    def test_history_taking_record_is_unaffected(self):
        record = TrainingRecord(workflow_id=DEFAULT_WORKFLOW_ID, case_snapshot=_CASE_DATA)
        assert workflow_for_record(record) is HISTORY_TAKING
        assert record_activity_available(record, "nursing_record") is True


class TestHistoryTakingRegression:
    def test_features_and_manifest_match_constant_based_resolution(self):
        """解析器接入后，问诊输出与服务端常量口径逐字节一致。"""
        record = TrainingRecord(
            workflow_id=DEFAULT_WORKFLOW_ID,
            case_snapshot=_CASE_DATA,
            practice_snapshot={"features": {"emotion": False}},
        )
        overrides = {"emotion": False}

        assert workflow_for_record(record).resolve_features(_CASE_DATA, overrides=overrides) == (
            HISTORY_TAKING.resolve_features(_CASE_DATA, overrides=overrides)
        )

        manifest = build_session_manifest(
            session_id=123,
            status=TrainingStatus.IN_PROGRESS,
            revision=13,
            case_data=_CASE_DATA,
            workflow=workflow_for_record(record),
            case_id=7,
        )
        assert manifest["workflow"] == {
            "id": "history_taking",
            "label": HISTORY_TAKING.label,
            "ui": dict(HISTORY_TAKING.ui),
        }
        assert {item["id"] for item in manifest["activities"]} == set(HISTORY_TAKING.activities)
        assert manifest["completion"]["conditions"] == [
            {"id": "nursing_record_submitted", "label": "提交护理记录", "satisfied": False}
        ]

    def test_case_gate_accepts_omitted_and_explicit_history_taking(self):
        """问诊病例：不声明 workflow 仍然合法；显式声明 history_taking 也合法。"""
        for data in (dict(_CASE_DATA), {**_CASE_DATA, "workflow": "history_taking"}):
            report = validate_case({"name": "契约病例", **data})
            assert [i for i in report.errors if i.field == CASE_WORKFLOW_FIELD] == []

    def test_case_gate_rejects_unregistered_workflow(self):
        report = validate_case({"name": "契约病例", **_CASE_DATA, "workflow": "reasoning_drill"})
        errors = [i for i in report.errors if i.field == CASE_WORKFLOW_FIELD]
        assert len(errors) == 1
        assert "reasoning_drill" in errors[0].message
        assert "history_taking" in errors[0].fix_hint

    def test_case_gate_rejects_empty_workflow_declaration(self):
        report = validate_case({"name": "契约病例", **_CASE_DATA, "workflow": "   "})
        errors = [i for i in report.errors if i.field == CASE_WORKFLOW_FIELD]
        assert len(errors) == 1

    def test_case_gate_requires_declaration_once_second_workflow_exists(self, two_workflows):
        report = validate_case({"name": "契约病例", **_CASE_DATA})
        errors = [i for i in report.errors if i.field == CASE_WORKFLOW_FIELD]
        assert len(errors) == 1
        assert "显式声明" in errors[0].message


class TestColumnContract:
    def test_column_is_not_null(self):
        column = TrainingRecord.__table__.c.workflow_id
        assert column.nullable is False
        assert str(column.server_default.arg) == f"'{DEFAULT_WORKFLOW_ID}'"

    def test_legacy_insert_without_workflow_id_backfills_history_taking(self, db: Session):
        """存量行/漏写走列默认值 = history_taking（判别列落地前唯一可能的答案）。

        用原生 INSERT 绕开 ORM 侧默认值，验证的是**DDL**（迁移）的回填行为。
        """
        user, case = _seed_student_and_case(db)
        db.execute(
            sa.text(
                "INSERT INTO training_records (user_id, case_id, status, time_limit, start_time) "
                "VALUES (:user_id, :case_id, 'in_progress', 20, :start_time)"
            ),
            {"user_id": user.id, "case_id": case.id, "start_time": datetime.now(UTC).replace(tzinfo=None).isoformat()},
        )

        stored = db.execute(sa.select(TrainingRecord.workflow_id)).scalar()
        assert stored == "history_taking"

    def test_explicit_workflow_id_is_frozen_on_the_row(self, db: Session):
        user, case = _seed_student_and_case(db)
        record = TrainingRecord(
            user_id=user.id,
            case_id=case.id,
            status="in_progress",
            time_limit=20,
            workflow_id="history_taking",
        )
        db.add(record)
        db.flush()

        # 训练中途不得被任何路径改写
        db.execute(sa.text("UPDATE training_records SET status = 'completed' WHERE id = :id"), {"id": record.id})
        stored = db.execute(sa.select(TrainingRecord.workflow_id).where(TrainingRecord.id == record.id)).scalar()
        assert stored == "history_taking"


class TestMigrationChain:
    def test_workflow_column_migration_is_on_the_single_head_lineage(self):
        from alembic.config import Config
        from alembic.script import ScriptDirectory

        ini = Path(__file__).resolve().parents[2] / "alembic.ini"
        script = ScriptDirectory.from_config(Config(str(ini)))
        heads = script.get_heads()
        assert len(heads) == 1, f"迁移链出现多个 head：{heads}"

        revision = script.get_revision("a9d0c1b2e3f4")
        assert revision is not None
        assert revision.down_revision == "f5a6b7c8d9e0"
        lineage = {rev.revision for rev in script.iterate_revisions(heads[0], "base")}
        assert "a9d0c1b2e3f4" in lineage
