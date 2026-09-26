"""护理评估生命周期回归：draft → submitted，提交冻结、完成前置、系统终止不伪造提交。

缺陷背景（产品价值：学生产物真实性）：
  前端只 3 秒自动保存草稿、从不提交，而 ``finalize_training`` 会把已有草稿自动标为
  submitted —— 于是「零评估也能完成训练」，评分读到的还是任意草稿内容。

本文件固定修复后的契约：
  - 草稿保存永远只写 draft，客户端传 ``status=submitted`` 也不能自封已提交；
  - 提交是显式动作，幂等，内容冻结；提交后编辑被拒（要改必须显式 reopen）；
  - 要求评估的 workflow 里，未提交就完成 → 拒绝（NursingAssessmentRequiredError），
    且拒绝不留下任何 scoring 占位；
  - 系统终止（超时 / 患者离开）不伪造提交，草稿不进评分证据，终端原因可区分；
  - 零问诊内容仍走「废弃」，不被评估前置条件改成报错。
"""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from core.exceptions import ValidationError
from models import NursingRecord, TrainingRecord
from modules.training.session.finalize import (
    END_ORIGIN_PATIENT_WALKOUT,
    END_ORIGIN_TIMEOUT,
    NursingAssessmentRequiredError,
    finalize_training,
    terminal_reason,
)
from modules.training.tools.base import ToolContext
from modules.training.tools.nursing_record import (
    STATUS_DRAFT,
    STATUS_SUBMITTED,
    NursingAssessmentEmptyError,
    NursingAssessmentMissingError,
    NursingRecordHandler,
    filled_fields,
    missing_fields,
    reopen_nursing_assessment,
    submit_nursing_assessment,
)
from tests._fakes import FakeSession

_CASE = {
    "patient_info": {"name": "李阿姨", "age": 70, "gender": "女"},
    "chief_complaint": "头晕",
    "activities": {"nursing_record": {"config": {"enabled": True}}},
}

_FIELDS = ("subjective", "objective", "assessment", "plan", "evaluation")

_SHEET = {
    "subjective": "患者主诉头晕",
    "objective": "BP 130/80",
    "assessment": "体液不足",
    "plan": "卧床休息",
    "evaluation": "",
}


# ── 工具面（handler）─────────────────────────────────────────────────────


def _ctx(*, db=None, case_data=None, user_id: int = 10) -> ToolContext:
    return ToolContext(
        record=SimpleNamespace(
            id=1,
            user_id=user_id,
            runtime_state=None,
            status="in_progress",
            case_snapshot=case_data or _CASE,
            practice_snapshot={},
        ),
        case_data=case_data or _CASE,
        current_user=SimpleNamespace(id=user_id, has_permission=lambda p: False),
        db=db or FakeSession(),
    )


async def _save(ctx: ToolContext, sheet: dict | None = None, **extra):
    params: dict = {"sheet_data": dict(sheet if sheet is not None else _SHEET)}
    params.update(extra)
    return await NursingRecordHandler().handle("save", params, ctx)


async def _submit(ctx: ToolContext, sheet: dict | None = None):
    params: dict = {} if sheet is None else {"sheet_data": dict(sheet)}
    return await NursingRecordHandler().handle("submit", params, ctx)


class TestFieldHelpers:
    def test_filled_and_missing_fields_follow_adpie_order(self):
        sheet = {"subjective": "S", "objective": "  ", "assessment": "A", "plan": "", "evaluation": ""}
        assert filled_fields(sheet) == ["subjective", "assessment"]
        assert missing_fields(sheet) == ["objective", "plan", "evaluation"]


class TestSubmitRequiresRealContent:
    def test_submit_without_record_rejected(self):
        """没有任何草稿 → 「尚未创建」，不得凭空造一份提交版。"""
        with pytest.raises(NursingAssessmentMissingError) as exc:
            submit_nursing_assessment(FakeSession(), record_id=1, user_id=10)

        assert "尚未创建" in exc.value.message

    def test_blank_submission_rejected_and_not_persisted(self):
        """零评估的另一种形态：全空提交——必须同样被拒，且不落库。"""
        db = FakeSession()

        with pytest.raises(NursingAssessmentEmptyError) as exc:
            submit_nursing_assessment(db, record_id=1, user_id=10, sheet_data=dict.fromkeys(_FIELDS, "   "))

        assert exc.value.missing_fields == list(_FIELDS)
        assert db.added == [], "被拒的空提交不得落库"


class TestSubmitFreezesContent:
    @pytest.mark.asyncio
    async def test_submit_sets_submitted_at_and_locks_edit(self):
        db = FakeSession()
        ctx = _ctx(db=db)

        draft = await _save(ctx)
        assert draft.ok is True
        assert draft.data["status"] == STATUS_DRAFT
        assert draft.data["submitted_at"] is None
        assert draft.data["editable"] is True

        submitted = await _submit(ctx)
        assert submitted.ok is True
        assert submitted.data["status"] == STATUS_SUBMITTED
        assert submitted.data["submitted_at"]
        assert submitted.data["editable"] is False

        # 提交后编辑 → 冲突，内容不被覆盖
        blocked = await _save(ctx, sheet={**_SHEET, "subjective": "偷改"})
        assert blocked.ok is False
        assert blocked.data["code"] == "nursing_record_submitted"
        assert "已提交" in blocked.error
        assert db.rows[1].sheet_data["subjective"] == _SHEET["subjective"]

    @pytest.mark.asyncio
    async def test_repeat_submit_is_idempotent(self):
        ctx = _ctx()
        await _save(ctx)

        first = await _submit(ctx)
        second = await _submit(ctx)

        assert first.ok is True
        assert second.ok is True
        assert second.data["submitted_at"] == first.data["submitted_at"]

    @pytest.mark.asyncio
    async def test_submit_with_changed_content_after_submit_is_conflict(self):
        ctx = _ctx()
        await _save(ctx)
        await _submit(ctx)

        result = await _submit(ctx, sheet={**_SHEET, "subjective": "另一版"})

        assert result.ok is False
        assert result.data["code"] == "nursing_record_submitted"

    @pytest.mark.asyncio
    async def test_submit_carries_last_draft_atomically(self):
        """原子「提交并完成」的服务端形态：携带内容时先落盘再冻结，一步到位。"""
        ctx = _ctx()

        result = await _submit(ctx, sheet=_SHEET)

        assert result.ok is True
        assert result.data["sheet_data"] == _SHEET
        assert result.data["submitted_at"]

    @pytest.mark.asyncio
    async def test_client_supplied_status_cannot_fake_submission(self):
        """save 的 status 由服务端独占：传 submitted 也只落成 draft。"""
        ctx = _ctx()

        result = await _save(ctx, status="submitted")

        assert result.data["status"] == STATUS_DRAFT
        assert ctx.db.rows[1].submitted_at is None

    @pytest.mark.asyncio
    async def test_reopen_returns_record_to_draft_then_editable_again(self):
        ctx = _ctx()
        await _save(ctx)
        await _submit(ctx)

        reopened = reopen_nursing_assessment(ctx.db, record_id=1)
        assert reopened.submitted_at is None
        assert reopened.status == STATUS_DRAFT

        again = await _save(ctx, sheet={**_SHEET, "subjective": "改后"})
        assert again.ok is True
        assert again.data["status"] == STATUS_DRAFT
        assert ctx.db.rows[1].sheet_data["subjective"] == "改后"

    @pytest.mark.asyncio
    async def test_reopen_when_never_submitted_is_noop(self):
        ctx = _ctx()
        await _save(ctx)

        result = await NursingRecordHandler().handle("reopen", {}, ctx)

        assert result.ok is True
        assert result.data["status"] == STATUS_DRAFT

    @pytest.mark.asyncio
    async def test_save_rejects_non_dict_sheet(self):
        with pytest.raises(ValidationError):
            await NursingRecordHandler().handle("save", {"sheet_data": "nope"}, _ctx())


# ── 完成前置条件（finalize_training）────────────────────────────────────


class _CountingQuery:
    """finalize 所需的最小查询替身：按模型名返回记录 / 护理评估 / 空。"""

    def __init__(self, session: "_FinalizeSession", model_name: str) -> None:
        self._session = session
        self._model_name = model_name

    def filter(self, *_criteria):
        return self

    def with_for_update(self):
        return self

    def first(self):
        if self._model_name == "TrainingRecord":
            return self._session.record
        if self._model_name == "NursingRecord":
            return self._session.nursing
        return None


class _FinalizeSession:
    def __init__(self, record: TrainingRecord, *, nursing: NursingRecord | None) -> None:
        self.record = record
        self.nursing = nursing
        self.refreshes = 0

    def query(self, model):
        return _CountingQuery(self, getattr(model, "__name__", ""))

    def execute(self, _statement, params=None):
        return SimpleNamespace(scalar=lambda: 1)

    def refresh(self, _obj) -> None:
        self.refreshes += 1


def _training_record(*, case_snapshot: dict | None = None) -> TrainingRecord:
    return TrainingRecord(
        id=1,
        user_id=10,
        status="in_progress",
        revision=0,
        case_snapshot=_CASE if case_snapshot is None else case_snapshot,
        practice_snapshot={},
        runtime_state=None,
    )


def _nursing_record(*, submitted: bool) -> NursingRecord:
    nr = NursingRecord(record_id=1, user_id=10, sheet_data=dict(_SHEET), status=STATUS_DRAFT)
    nr.submitted_at = datetime.now(UTC) if submitted else None
    return nr


@pytest.fixture
def _has_messages():
    with patch("modules.training.session.finalize.student_message_count", return_value=2):
        yield


@pytest.mark.usefixtures("_has_messages")
class TestCompletionGate:
    def test_unsubmitted_draft_blocks_user_completion(self):
        record = _training_record()
        db = _FinalizeSession(record, nursing=_nursing_record(submitted=False))

        with pytest.raises(NursingAssessmentRequiredError) as exc:
            finalize_training(db, 1, require_nursing_submission=True)

        assert exc.value.code == "nursing_record_required"
        assert "护理评估" in exc.value.message
        # 关键：拒绝发生在 acquire_scoring 之前 —— 不留下任何 scoring 占位
        assert record.status == "in_progress"
        assert record.end_time is None

    def test_missing_record_also_blocks_user_completion(self):
        record = _training_record()

        with pytest.raises(NursingAssessmentRequiredError):
            finalize_training(_FinalizeSession(record, nursing=None), 1, require_nursing_submission=True)

        assert record.status == "in_progress"

    def test_workflow_without_nursing_capability_is_unaffected(self):
        record = _training_record(case_snapshot={"patient_info": {"name": "王"}})
        db = _FinalizeSession(record, nursing=None)

        with patch("modules.training.session.finalize.acquire_scoring", return_value=True):
            claimed, kind, case_data = finalize_training(db, 1, require_nursing_submission=True)

        assert (claimed, kind) == (True, "completed")
        assert case_data == {"patient_info": {"name": "王"}}

    def test_submitted_version_completes_and_records_user_origin(self):
        record = _training_record()
        db = _FinalizeSession(record, nursing=_nursing_record(submitted=True))

        with patch("modules.training.session.finalize.acquire_scoring", return_value=True):
            claimed, kind, _ = finalize_training(db, 1, require_nursing_submission=True)

        assert (claimed, kind) == (True, "completed")
        assert record.status == "completed"
        assert terminal_reason(record) == "user_end"

    def test_system_termination_does_not_fake_submission(self):
        """超时终止：不要求提交，也绝不把草稿改成 submitted；原因单独记录。"""
        record = _training_record()
        nursing = _nursing_record(submitted=False)
        db = _FinalizeSession(record, nursing=nursing)

        with patch("modules.training.session.finalize.acquire_scoring", return_value=True):
            claimed, kind, _ = finalize_training(db, 1, origin=END_ORIGIN_TIMEOUT)

        assert (claimed, kind) == (True, "completed")
        assert nursing.submitted_at is None, "系统终止伪造了「学生已提交」"
        assert nursing.status == STATUS_DRAFT
        assert terminal_reason(record) == END_ORIGIN_TIMEOUT

    def test_patient_walkout_origin_is_distinguishable(self):
        record = _training_record()
        nursing = _nursing_record(submitted=False)
        db = _FinalizeSession(record, nursing=nursing)

        with patch("modules.training.session.finalize.acquire_scoring", return_value=True):
            finalize_training(db, 1, origin=END_ORIGIN_PATIENT_WALKOUT)

        assert terminal_reason(record) == END_ORIGIN_PATIENT_WALKOUT
        assert nursing.submitted_at is None

    def test_record_not_in_progress_is_never_claimed(self):
        record = _training_record()
        record.status = "completed"
        db = _FinalizeSession(record, nursing=_nursing_record(submitted=False))

        assert finalize_training(db, 1, require_nursing_submission=True) == (False, None, None)


class TestDiscardWithoutStudentMessages:
    """零问诊内容 → 废弃。**不能**套用 _has_messages fixture，否则测的是相反场景。"""

    def test_no_student_messages_still_discards(self):
        """零问诊内容 = 废弃（无评分），不被评估前置条件改成报错。"""
        record = _training_record()
        db = _FinalizeSession(record, nursing=None)

        with (
            patch("modules.training.session.finalize.student_message_count", return_value=0),
            patch("modules.training.session.finalize.acquire_scoring", return_value=True),
            patch("modules.training.session.finalize.mark_discarded") as mark_discarded,
        ):
            claimed, kind, case_data = finalize_training(db, 1, require_nursing_submission=True)

        assert (claimed, kind, case_data) == (True, "discarded", None)
        mark_discarded.assert_called_once()
