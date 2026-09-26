"""对话回合两阶段持久化 + 幂等（HTTP 层，真实路由 + 替身 session/LLM）。

覆盖 docs/15 §五 的验收：
  ① LLM 失败 → 学生消息已落库、turn=failed、稳定错误码（旧实现：整轮静默丢失）；
  ② 同 request_id 重放 → 不产生第二条学生消息，也不再发起 LLM；
  ③ 成功 → 患者消息落库、turn=completed、完成帧带 patient id；
  ④ 收到 409 的三种既有状态（生成中 / 已失败 / 键冲突）都不重复开始 LLM。

替身 session 只在**事务边界**上模拟真实 DB：``add`` 进 pending、``commit`` 才落库、
``rollback`` 丢弃 pending。因此断言可以落在"真正提交了的行"上——这正是本切片要
证明的东西（学生消息必须在 LLM 之前提交，患者消息在之后提交）。
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, cast

import pytest
from fastapi.testclient import TestClient

import modules.training.router.chat as chat_router
from core.database import get_db
from core.security import get_current_user
from main import app
from models import Message, TrainingAction, TrainingRecord
from modules.training.pipeline import STATE_TURN
from modules.training.pipeline.turn import (
    TURN_KIND,
    TurnClaim,
    TurnStatus,
    finalize_pending_turn,
)

if TYPE_CHECKING:
    from fastapi import FastAPI

CASE_DATA = {
    "name": "回合持久化病例",
    "patient_info": {"name": "张伟", "age": 54, "gender": "男"},
    "chief_complaint": "咳嗽三天",
    "present_illness": "三天前开始咳嗽",
    "activities": {"physical_exam": {"config": {"vital_signs": {"temperature": "37.2-37.8"}}}},
}

STREAM_URL = "/api/chat/5/message/stream"
# 关闭内置特性（情绪/主动追问）：本测试只验回合持久化，不牵扯情绪 LLM 与计时器
PRACTICE = {"features": {"emotion": False, "patient_initiative": False}}


def _model_name(model) -> str:
    return getattr(model, "__name__", None) or getattr(getattr(model, "table", None), "name", "Message")


class _Query:
    """替身查询：只支持 turn/持久化链真正用到的形状。

    非标量右值（``Message.id.in_(subquery)``）视为无约束——替身不实现子查询语义，
    历史窗口在测试里本来就是空的。
    """

    def __init__(self, session: _StubSession, model) -> None:
        self._session = session
        self._name = _model_name(model)
        self._criteria: list[tuple[str, object]] = []

    def filter(self, *criteria):
        for criterion in criteria:
            key = getattr(getattr(criterion, "left", None), "key", None)
            right = getattr(criterion, "right", None)
            value = getattr(right, "value", None)
            if key and not isinstance(value, (str, int, bool)) and value is not None:
                continue
            if key:
                self._criteria.append((key, value))
        return self

    def with_for_update(self):
        return self

    def order_by(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def subquery(self):
        return self

    def __clause_element__(self):
        # 让替身查询能出现在 in_() 里（router 的历史窗口用子查询做 DB I/O 限流）
        from sqlalchemy import select

        return select(Message.id)

    @property
    def c(self):
        return type("_C", (), {"id": []})()

    def _rows(self) -> list:
        rows = self._session.table(self._name)
        for key, value in self._criteria:
            if value is None:
                rows = [r for r in rows if getattr(r, key, None) is None]
            else:
                rows = [r for r in rows if getattr(r, key, None) == value]
        return rows

    def first(self):
        rows = self._rows()
        return rows[0] if rows else None

    def all(self) -> list:
        return list(self._rows())

    def scalar(self):
        rows = self._rows()
        return rows[0] if rows else 0

    def count(self) -> int:
        return len(self._rows())


class _StubSession:
    """按事务边界记账的替身 session（见模块 docstring）。"""

    def __init__(self) -> None:
        self._tables: dict[str, list] = {"TrainingRecord": [], "TrainingAction": [], "Message": [], "Case": []}
        self.pending: list = []
        self._next_id = 1000
        self.commits = 0
        self.rollbacks = 0

    # ── 表访问 ──
    def table(self, name: str) -> list:
        return self._tables.setdefault(name, [])

    def seed(self, row) -> None:
        self._assign_id(row)
        self.table(type(row).__name__).append(row)

    def _assign_id(self, row) -> None:
        if getattr(row, "id", None) is None:
            row.id = self._next_id
            self._next_id += 1

    def rows(self, model_or_name) -> list:
        name = model_or_name if isinstance(model_or_name, str) else _model_name(model_or_name)
        return list(self.table(name))

    # ── Session API ──
    def query(self, model):
        return _Query(self, model)

    def add(self, obj) -> None:
        self.pending.append(obj)

    def flush(self) -> None:
        for obj in self.pending:
            self._assign_id(obj)

    def commit(self) -> None:
        self.flush()
        for obj in self.pending:
            bucket = self.table(type(obj).__name__)
            if obj not in bucket:
                bucket.append(obj)
        self.pending = []
        self.commits += 1

    def rollback(self) -> None:
        for obj in self.pending:
            bucket = self.table(type(obj).__name__)
            if obj in bucket:
                bucket.remove(obj)
        self.pending = []
        self.rollbacks += 1

    def refresh(self, _obj) -> None:
        pass

    def get(self, model, pk):
        for row in self.table(_model_name(model)):
            if getattr(row, "id", None) == pk:
                return row
        return None

    def delete(self, obj) -> None:
        bucket = self.table(type(obj).__name__)
        if obj in bucket:
            bucket.remove(obj)

    def execute(self, *_a, **_k):
        return type("_R", (), {"scalar": staticmethod(lambda: None)})()

    def close(self) -> None:
        pass


class _FakeUser:
    id = 1
    display_name = "测试学生"

    def has_permission(self, _permission: str) -> bool:
        return False


class _NoLimit:
    async def is_allowed(self, *_a, **_k) -> bool:
        return True


class _FakeLLM:
    """替身 LLM：可成功、可失败；记录调用时"已提交的学生消息"。"""

    def __init__(
        self, *, reply: str = "我咳嗽三天了。", error: Exception | None = None, session: _StubSession | None = None
    ) -> None:
        self.reply = reply
        self.error = error
        self.session = session
        self.calls: list[list[dict]] = []
        self.committed_student_at_call: list[int] = []
        self.commits_at_call: list[int] = []

    async def stream(self, messages, **_kwargs):
        self.calls.append([dict(m) for m in messages])
        if self.session is not None:
            students = [m for m in self.session.rows(Message) if m.role == "student"]
            self.committed_student_at_call.append(len(students))
            self.commits_at_call.append(self.session.commits)
        if self.error is not None:
            raise self.error
        yield self.reply

    async def call(self, messages, **_kwargs):
        self.calls.append([dict(m) for m in messages])
        if self.error is not None:
            raise self.error
        return self.reply


def _record(**overrides):
    values = {
        "id": 5,
        "user_id": 1,
        "case_id": 9,
        "status": "in_progress",
        "revision": 0,
        "case_snapshot": CASE_DATA,
        "practice_snapshot": PRACTICE,
        "runtime_state": {},
        "time_limit": 30,
        "start_time": datetime.now(UTC),
        "is_test": False,
        "scoring_status": None,
    }
    values.update(overrides)
    record = TrainingRecord(**values)
    record.messages = []
    record.score = None
    record.case = None
    record.user = None
    return record


def _stub_db_session(session: _StubSession):
    """替身 ``core.database.db_session``：stream 端点自建 session（不经 DI），只能替换它。"""

    @asynccontextmanager
    async def _factory():
        try:
            yield session
        finally:
            session.close()

    return _factory


def _client(*, llm: _FakeLLM, session: _StubSession, monkeypatch, record=None):
    if record is not None:
        session.seed(record)

    def _override_db():
        yield session

    monkeypatch.setattr(chat_router, "db_session", _stub_db_session(session))
    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = lambda: _FakeUser()
    app.state.rate_limiter = _NoLimit()
    app.state.llm_client = llm
    return TestClient(cast("FastAPI", app))


@pytest.fixture(autouse=True)
def _reset_app_overrides():
    yield
    app.dependency_overrides.clear()


def _post(client: TestClient, *, content: str = "你好，哪里不舒服？", request_id: str | None = None):
    body: dict = {"content": content}
    if request_id is not None:
        body["request_id"] = request_id
    return client.post(STREAM_URL, json=body)


def _frames(response) -> list[str]:
    return [line for line in response.text.splitlines() if line.startswith("data: ")]


def _turn_rows(session: _StubSession) -> list[TrainingAction]:
    return [row for row in session.rows(TrainingAction) if row.kind == TURN_KIND]


# ── ① LLM 失败：学生消息已落库 + turn=failed ─────────────────────────────


def test_llm_failure_keeps_student_message_and_marks_turn_failed(monkeypatch):
    session = _StubSession()
    llm = _FakeLLM(error=RuntimeError("provider exploded"), session=session)
    client = _client(llm=llm, session=session, monkeypatch=monkeypatch, record=_record())

    response = _post(client, request_id="turn-1")

    assert response.status_code == 200
    assert "chat.llm_unavailable" in response.text
    # 学生这一句在 LLM 调用之前就已提交（旧实现：整轮静默丢失）
    # 学生消息必须在任何 LLM 调用之前提交
    assert llm.committed_student_at_call
    assert llm.committed_student_at_call[0] == 1
    # 事务 A 是 LLM 之前唯一的事务：LLM/流式期间不再持有数据库事务
    assert llm.commits_at_call == [1, 1]
    students = [m for m in session.rows(Message) if m.role == "student"]
    assert [m.content for m in students] == ["你好，哪里不舒服？"]
    assert [m for m in session.rows(Message) if m.role == "patient"] == []

    turns = _turn_rows(session)
    assert len(turns) == 1
    assert turns[0].result["status"] == TurnStatus.FAILED
    assert turns[0].result["error_code"] == "chat.llm_unavailable"
    assert turns[0].result["student_message_id"] == students[0].id


# ── ② 同 request_id 重放：不重复插学生消息、不重复调 LLM ────────────────


def test_replay_same_request_id_does_not_duplicate_student_message(monkeypatch):
    session = _StubSession()
    llm = _FakeLLM(reply="我咳嗽三天了。", session=session)
    client = _client(llm=llm, session=session, monkeypatch=monkeypatch, record=_record())

    first = _post(client, request_id="turn-2")
    calls_after_first = len(llm.calls)
    second = _post(client, request_id="turn-2")

    assert first.status_code == second.status_code == 200
    assert len([m for m in session.rows(Message) if m.role == "student"]) == 1
    assert len([m for m in session.rows(Message) if m.role == "patient"]) == 1
    assert len(_turn_rows(session)) == 1
    # 重放不重新开始 LLM：调用次数不变
    assert len(llm.calls) == calls_after_first
    # 回放同一结果：患者正文与完成帧的 patient id 一致
    assert "我咳嗽三天了。" in second.text
    patient = next(m for m in session.rows(Message) if m.role == "patient")
    assert f'"id": {patient.id}' in second.text


def test_different_request_id_starts_a_new_turn(monkeypatch):
    session = _StubSession()
    llm = _FakeLLM(reply="嗯。", session=session)
    client = _client(llm=llm, session=session, monkeypatch=monkeypatch, record=_record())

    _post(client, content="第一句", request_id="a")
    _post(client, content="第二句", request_id="b")

    assert [m.content for m in session.rows(Message) if m.role == "student"] == ["第一句", "第二句"]
    assert len(_turn_rows(session)) == 2


# ── ③ 成功：患者消息 + turn=completed ────────────────────────────────────


def test_success_persists_patient_message_and_completes_turn(monkeypatch):
    session = _StubSession()
    llm = _FakeLLM(reply="我咳嗽三天了，痰不多。", session=session)
    client = _client(llm=llm, session=session, monkeypatch=monkeypatch, record=_record())

    response = _post(client, request_id="turn-3")

    assert response.status_code == 200
    assert "我咳嗽三天了，痰不多。" in response.text
    patient = [m for m in session.rows(Message) if m.role == "patient"]
    assert len(patient) == 1
    assert patient[0].content == "我咳嗽三天了，痰不多。"
    turn = _turn_rows(session)[0]
    assert turn.result["status"] == TurnStatus.COMPLETED
    assert turn.result["patient_message_id"] == patient[0].id
    assert f'"id": {patient[0].id}' in response.text
    assert '"done": true' in response.text


# ── ④ 既有状态的三种回放：都不重复开始 LLM ───────────────────────────────


def _seeded_turn(session: _StubSession, *, status: str, request_id: str = "turn-4", started_at: datetime | None = None):
    """播下一个记录 + 已落库的学生消息 + 既有 turn 行（模拟重放/续跑场景）。"""
    started = started_at or datetime.now(UTC)
    record = _record()
    session.seed(record)
    student = Message(record_id=record.id, role="student", content="你好")
    session.seed(student)
    row = TrainingAction(
        record_id=record.id,
        request_id=request_id,
        kind=TURN_KIND,
        input={"content": "你好"},
        result={"status": status, "student_message_id": student.id, "started_at": started.isoformat()},
        created_at=started,
    )
    session.seed(row)
    return record, student, row


@pytest.mark.parametrize("status", [TurnStatus.PENDING, TurnStatus.FAILED])
def test_replay_of_unfinished_or_failed_turn_does_not_restart_llm(monkeypatch, status):
    session = _StubSession()
    llm = _FakeLLM(session=session)
    _seeded_turn(session, status=status)
    client = _client(llm=llm, session=session, monkeypatch=monkeypatch)

    response = _post(client, content="你好", request_id="turn-4")

    assert response.status_code == 409, response.text
    assert llm.calls == []
    assert len([m for m in session.rows(Message) if m.role == "student"]) == 1


def test_failed_turn_replay_returns_stored_error_code(monkeypatch):
    session = _StubSession()
    llm = _FakeLLM(session=session)
    _record_obj, _student, row = _seeded_turn(session, status=TurnStatus.FAILED)
    row.result = {**row.result, "error_code": "chat.llm_unavailable", "error": "LLM 服务暂时不可用，请稍后重试"}
    client = _client(llm=llm, session=session, monkeypatch=monkeypatch)

    response = _post(client, content="你好", request_id="turn-4")

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "chat.llm_unavailable"
    assert response.json()["detail"]["replayed"] is True
    assert llm.calls == []


def test_stale_pending_turn_is_resumed_without_duplicate_student_message(monkeypatch):
    session = _StubSession()
    llm = _FakeLLM(reply="我很难受。", session=session)
    _record_obj, student, _row = _seeded_turn(
        session,
        status=TurnStatus.PENDING,
        started_at=datetime.now(UTC) - timedelta(minutes=10),
    )
    client = _client(llm=llm, session=session, monkeypatch=monkeypatch)

    response = _post(client, content="你好", request_id="turn-4")

    assert response.status_code == 200, response.text
    assert len(llm.calls) == 1
    students = [m for m in session.rows(Message) if m.role == "student"]
    assert students == [student]  # 沿用已落库的学生消息，不插第二条
    assert _turn_rows(session)[0].result["status"] == TurnStatus.COMPLETED


def test_request_id_reuse_with_different_content_is_conflict(monkeypatch):
    session = _StubSession()
    llm = _FakeLLM(session=session)
    _record_obj, _student, row = _seeded_turn(session, status=TurnStatus.COMPLETED)
    row.result = {**row.result, "patient_message_id": 999}
    client = _client(llm=llm, session=session, monkeypatch=monkeypatch)

    response = _post(client, content="完全不同的内容", request_id="turn-4")

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "chat.turn_conflict"
    assert llm.calls == []


def test_invalid_request_id_is_rejected_before_any_write(monkeypatch):
    session = _StubSession()
    llm = _FakeLLM(session=session)
    client = _client(llm=llm, session=session, monkeypatch=monkeypatch, record=_record())

    response = _post(client, request_id="bad id with spaces")

    assert response.status_code == 400
    assert session.rows(Message) == []
    assert session.rows(TrainingAction) == []


# ── 兜底：链路异常时回合绝不静默留在 pending ─────────────────────────────


class TestTurnSafetyNet:
    """persister 没跑到（中间件抛异常）时由 runner 的 finally 收尾。"""

    @staticmethod
    def _ctx(session: _StubSession, *, claim, error_code: str | None = None, error: str | None = None):
        from types import SimpleNamespace

        return SimpleNamespace(
            db=session,
            record=SimpleNamespace(id=5),
            state={STATE_TURN: claim} if claim is not None else {},
            error=error,
            error_code=error_code,
        )

    def _pending_claim(self, session: _StubSession):
        _record_obj, student, row = _seeded_turn(session, status=TurnStatus.PENDING)
        return row, student

    @pytest.mark.asyncio
    async def test_pending_turn_is_marked_failed_with_stable_code(self):
        session = _StubSession()
        row, student = self._pending_claim(session)
        claim = TurnClaim(
            turn_id=row.id,
            record_id=5,
            request_id=row.request_id,
            status=TurnStatus.PENDING,
            student_message_id=student.id,
        )
        ctx = self._ctx(session, claim=claim, error_code="chat.pipeline_error", error="boom")

        await finalize_pending_turn(ctx)

        assert row.result["status"] == TurnStatus.FAILED
        assert row.result["error_code"] == "chat.pipeline_error"
        # 学生消息保留（回合失败不改写已经说过的话）
        assert [m for m in session.rows(Message) if m.role == "student"] == [student]

    @pytest.mark.asyncio
    async def test_completed_turn_is_untouched(self):
        session = _StubSession()
        row, student = self._pending_claim(session)
        row.result = {**row.result, "status": TurnStatus.COMPLETED}
        claim = TurnClaim(
            turn_id=row.id,
            record_id=5,
            request_id=row.request_id,
            status=TurnStatus.COMPLETED,
            student_message_id=student.id,
        )
        commits_before = session.commits
        ctx = self._ctx(session, claim=claim)

        await finalize_pending_turn(ctx)

        assert row.result["status"] == TurnStatus.COMPLETED
        assert session.commits == commits_before

    @pytest.mark.asyncio
    async def test_persister_refuses_to_write_without_turn_claim(self):
        """绕过 begin_turn 的调用方不得半截持久化（写一半比不写更危险）。"""
        from modules.training.pipeline.middleware.persister import persister

        session = _StubSession()
        session.seed(_record())
        ctx = self._ctx(session, claim=None)
        ctx.student_input = "你好"
        ctx.llm_reply = "我很难受"
        reached: list[str] = []

        async def _next():
            reached.append("next")

        await persister(ctx, _next)

        assert session.rows(Message) == []
        assert session.rows(TrainingAction) == []
        assert ctx.error_code == "chat.turn_claim_missing"
        # 不阻断后续中间件（侧效果仍要跑），但错误已记账
        assert reached == ["next"]
