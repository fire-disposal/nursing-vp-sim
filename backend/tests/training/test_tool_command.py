"""工具指令面测试（Phase 2.5）：纯函数 + 中央失败契约 + 幂等回放。

回归目标（review qa-voice-tools #4/#5/#6）：
  - 四类失败（未知工具 / 未知 action / 未启用 / 越权）统一抛 HTTP 异常，
    handler 内不再各写一套 ok=False；
  - 未知 op_type 不再以 ok=true 落一条伪查体记录（污染审计与评分）；
  - 同一 idem_key 重发的响应与首次逐字段相等（含 scene，旧实现回放 scene=null）。
"""

from types import SimpleNamespace

import pytest

from core.exceptions import AuthError, ValidationError
from models import TrainingAction, TrainingRecord
from modules.training.tools.base import ToolContext
from modules.training.tools.service import execute_tool_command, parse_cmd
from tests._fakes import UpdateCapableFakeSession, _UpdateQuery


def test_parse_cmd_split():
    assert parse_cmd("physical_exam.measure") == ("physical_exam", "measure")


def test_parse_cmd_missing_dot():
    with pytest.raises(ValidationError):
        parse_cmd("physical_exam")


def test_parse_cmd_empty_parts():
    with pytest.raises(ValidationError):
        parse_cmd(".measure")
    with pytest.raises(ValidationError):
        parse_cmd("physical_exam.")


class _ToolQuery(_UpdateQuery):
    """补 with_for_update()（service 的行锁查询）。"""

    def with_for_update(self):
        return self


class _ToolSession(UpdateCapableFakeSession):
    """工具面所需的最小 session：行锁查询 + 条件 revision 自增 + 事务语义。

    commit/rollback 会搬运/丢弃 pending 行，因此断言可以落在"真正落库的行"上
    （路由层对 ValidationError 会 rollback，占位行不该留下）。
    """

    def __init__(self, revision: int = 0) -> None:
        super().__init__()
        self.revision = revision
        self.pending: list = []
        self.committed: list = []
        self.commits = 0
        self.rollbacks = 0

    def query(self, model: object) -> _ToolQuery:
        return _ToolQuery(self, getattr(model, "__name__", type(model).__name__))

    def add(self, obj: object) -> None:
        super().add(obj)
        self.pending.append(obj)

    def execute(self, _statement, params=None):
        expected = (params or {}).get("exp")
        if self.revision == expected:
            self.revision += 1
            return SimpleNamespace(scalar=lambda: self.revision)
        return SimpleNamespace(scalar=lambda: None)

    def commit(self) -> None:
        self.commits += 1
        self.committed.extend(self.pending)
        self.pending.clear()

    def rollback(self) -> None:
        self.rollbacks += 1
        for obj in self.pending:
            bucket = self._bucket(type(obj).__name__)
            if obj in bucket:
                bucket.remove(obj)
        self.pending.clear()


def _case_data(*, enabled: bool = True) -> dict:
    """病例声明：``activities.<id>.config``（无声明 → 未启用，见 docs/15 §四）。"""
    activities = (
        {
            "physical_exam": {"config": {"groups": [], "vital_signs": {"pain_score": "4-6"}}},
            "nursing_record": {"config": {"enabled": True}},
            "quiz": {"config": {"questions": [{"id": "q1", "stem": "题干", "options": ["A"], "answer": "A"}]}},
            "nursing_diagnosis": {"config": {"enabled": True}},
        }
        if enabled
        else {}
    )
    return {
        "patient_info": {"name": "王建国", "age": 68, "gender": "男"},
        "chief_complaint": "喘不上气",
        "activities": activities,
    }


#: 四个工具各取一个合法 action —— 用于验证失败契约在工具之间一致
_TOOL_ACTIONS: dict[str, str] = {
    "physical_exam": "measure",
    "nursing_record": "load",
    "quiz": "load",
    "nursing_diagnosis": "load",
}


def _env(*, owner_id: int = 10, user_id: int = 10, can_review: bool = False, enabled: bool = True):
    case_data = _case_data(enabled=enabled)
    record = TrainingRecord(
        id=1,
        user_id=owner_id,
        status="in_progress",
        revision=0,
        case_snapshot=case_data,
        practice_snapshot={},
        runtime_state=None,
    )
    db = _ToolSession(revision=0)
    db.add(record)
    record_user = SimpleNamespace(
        id=user_id, has_permission=lambda permission: permission == "score_review" and can_review
    )
    return ToolContext(record=record, case_data=case_data, current_user=record_user, db=db), db


async def _run(ctx, db, *, cmd="physical_exam.measure", params=None, idem_key="k1", revision=None):
    return await execute_tool_command(
        record_id=1,
        cmd=cmd,
        params=params if params is not None else {"op_type": "pain"},
        idem_key=idem_key,
        revision=revision,
        ctx=ctx,
    )


class TestFailureContract:
    """四类失败统一为 HTTP 异常（400/403），不再走 200 + ok=false。"""

    @pytest.mark.asyncio
    async def test_unknown_tool(self):
        ctx, db = _env()
        with pytest.raises(ValidationError):
            await _run(ctx, db, cmd="no_such_tool.measure")

    @pytest.mark.asyncio
    async def test_unknown_action(self):
        ctx, db = _env()
        with pytest.raises(ValidationError):
            await _run(ctx, db, cmd="physical_exam.nope")

    @pytest.mark.asyncio
    async def test_disabled_tool(self):
        ctx, db = _env(enabled=False)
        with pytest.raises(ValidationError):
            await _run(ctx, db)

    @pytest.mark.asyncio
    async def test_other_users_record_denied(self):
        ctx, db = _env(owner_id=5, user_id=10)
        with pytest.raises(AuthError):
            await _run(ctx, db)

    @pytest.mark.asyncio
    async def test_reviewer_cannot_measure_others_record(self):
        ctx, db = _env(owner_id=5, user_id=10, can_review=True)
        with pytest.raises(AuthError):
            await _run(ctx, db)

    @pytest.mark.asyncio
    async def test_reviewer_can_still_read_others_record(self):
        """只读动作对评分复核开放——越权收紧不得把教师复核一起挡掉。"""
        ctx, db = _env(owner_id=5, user_id=10, can_review=True)
        result = await _run(ctx, db, cmd="nursing_record.load", params={})
        assert result.ok is True

    @pytest.mark.asyncio
    async def test_unknown_op_type_produces_no_audit_row(self):
        """旧实现：未知 op 以 ok=true + kind="physical_exam" 落库，污染审计与评分。"""
        ctx, db = _env()

        with pytest.raises(ValidationError):
            await _run(ctx, db, params={"op_type": "bogus"})

        assert [row for row in db.committed if isinstance(row, TrainingAction)] == []
        assert not (ctx.record.runtime_state or {}).get("exam_results")

    @pytest.mark.parametrize(("tool", "action"), sorted(_TOOL_ACTIONS.items()))
    @pytest.mark.asyncio
    async def test_contract_is_uniform_across_all_tools(self, tool, action):
        """未知 action / 未启用 / 越权在四个工具上返回同一状态码。"""
        ctx, db = _env()
        with pytest.raises(ValidationError):
            await _run(ctx, db, cmd=f"{tool}.nope")

        ctx, db = _env(enabled=False)
        with pytest.raises(ValidationError):
            await _run(ctx, db, cmd=f"{tool}.{action}")

        ctx, db = _env(owner_id=5, user_id=10)
        with pytest.raises(AuthError):
            await _run(ctx, db, cmd=f"{tool}.{action}")


class TestIdempotentReplay:
    @pytest.mark.asyncio
    async def test_replay_returns_identical_ok_data_scene(self):
        ctx, db = _env()

        first = await _run(ctx, db, idem_key="retry-1")
        second = await _run(ctx, db, idem_key="retry-1")

        assert first.ok
        assert second.ok
        assert second.data == first.data
        assert second.scene == first.scene
        assert second.scene, "回放必须带 scene（旧实现硬编码 scene=null → 监护卡不更新）"
        assert second.scene["vitals"]["pain"] == first.scene["vitals"]["pain"]
        # 回放不得再次执行：查体历史只追加一次，revision 只推进一次
        assert len(ctx.record.runtime_state["exam_results"]) == 1
        assert db.revision == 1

    @pytest.mark.asyncio
    async def test_stored_row_carries_data_and_scene(self):
        ctx, db = _env()

        result = await _run(ctx, db, idem_key="retry-2")

        rows = [row for row in db.committed if isinstance(row, TrainingAction)]
        assert len(rows) == 1
        stored = rows[0].result
        assert stored["data"] == result.data
        assert stored["scene"] == result.scene
        assert stored["scene"]["vitals"]["pain"] == 5
