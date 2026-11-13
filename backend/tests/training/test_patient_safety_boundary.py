"""患者回复安全边界（外置红线规则库）的体验测试。

重点不是"能否识别危险词"（规则库在仓库之外，训练代码不认识任何词表），而是
**规则命中之后系统还对不对**：

1. 没有配置规则库时完全无副作用（不拦学生输入、不拦输出、不加任何内置词表）；
2. V1 最终候选命中 → 学生这句保留、患者这句既不落库也不进 SSE、回合带稳定错误码；
3. 泄漏修正/重试之后的候选同样要过红线（不是只检查第一次输出）；
4. 修正（message correction）命中 → 原来那条问答**不能被替换删除**；
5. V2 命中 → 不落库、不推 SSE、错误码稳定，且证据状态不前进；
6. 主动追问命中 → 只丢弃，`triggered` 保持 false。

规则库全部是测试内的替身（按整串相等判定），不需要 LLM，也不需要真实词表。
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from modules.training.patient_ai.safety import (
    SAFETY_BLOCKED_CODE,
    SAFETY_BLOCKED_MESSAGE,
    inspect_configured_patient_reply,
)
from modules.training.pipeline.context import (
    STATE_LEAK_CORRECTION_COUNT,
    STATE_SAVED_MESSAGES,
    STATE_STREAM_MODE,
    STATE_STREAM_QUEUE,
    STATE_TURN,
    PipelineContext,
    message_views,
)
from modules.training.pipeline.middleware.llm_caller import llm_caller
from modules.training.pipeline.middleware.persister import persister
from modules.training.pipeline.turn import begin_turn

STUDENT_LINE = "你先别急，我想先了解一下你现在最难受的是什么。"
PATIENT_OK = "就是胸口发闷，喘不上气。"
PATIENT_BLOCKED = "这句患者台词被外置规则判为红线内容。"


class StubRules:
    """外置规则库替身：整串相等即命中，证明训练代码不依赖任何词表。"""

    def __init__(self, blocked: str, *, code: str = "external.redline") -> None:
        self.blocked = blocked
        self.code = code
        self.seen: list[str] = []

    def find_violation(self, reply: str):
        self.seen.append(reply)
        return SimpleNamespace(code=self.code) if reply.strip() == self.blocked else None


class StubLLM:
    """顺序返回预设回复的 LLM 替身（batch 与 stream 两条路径共用）。"""

    def __init__(self, replies: list[str]) -> None:
        self.replies = replies
        self.calls = 0

    async def call(self, messages, **kwargs):
        index = min(self.calls, len(self.replies) - 1)
        self.calls += 1
        return self.replies[index]

    async def stream(self, messages, **kwargs):
        reply = await self.call(messages, **kwargs)
        yield reply


CASE_PATH = Path(__file__).resolve().parents[2] / "data" / "cases" / "asthma_evidence_v2.json"


@pytest.fixture(scope="module")
def case_data() -> dict:
    return json.loads(CASE_PATH.read_text(encoding="utf-8"))


@pytest.fixture
def record_factory(pg_session):
    from models import Case, TrainingRecord
    from tests.conftest import ensure_school, make_user

    db = pg_session
    school = ensure_school(db)
    user = make_user(db, school=school)

    def _make(**overrides):
        case = Case(name="安全边界测试病例", description="", difficulty=2, time_limit_minutes=30)
        db.add(case)
        db.flush()
        values = {
            "user_id": user.id,
            "case_id": case.id,
            "status": "in_progress",
            "workflow_id": "history_taking",
            "runtime_state": {},
        }
        values.update(overrides)
        record = TrainingRecord(**values)
        db.add(record)
        db.flush()
        return record, user

    return _make


def _ctx(db, record, user, app_state, *, claim=None, correction=None, stream=False, queue=None):
    ctx = PipelineContext(
        record=record,
        case_data={},
        current_user=user,
        db=db,
        app_state=app_state,
        student_input=STUDENT_LINE,
        messages=[],
    )
    if claim is not None:
        ctx.state[STATE_TURN] = claim
    if correction is not None:
        from modules.training.pipeline.context import STATE_CORRECTION_TARGET

        ctx.state[STATE_CORRECTION_TARGET] = correction
    if stream:
        ctx.llm_messages = [{"role": "system", "content": "患者人设"}]
        ctx.state[STATE_STREAM_MODE] = True
        ctx.state[STATE_STREAM_QUEUE] = queue
    return ctx


# ── 契约：未配置规则库 = 不检查 ─────────────────────────────────────────────


def test_no_configured_rules_means_no_check():
    assert inspect_configured_patient_reply(PATIENT_BLOCKED, SimpleNamespace()) is None
    assert inspect_configured_patient_reply(PATIENT_OK, SimpleNamespace(patient_safety_rules=None)) is None

    rules = StubRules(PATIENT_BLOCKED)
    assert inspect_configured_patient_reply(PATIENT_BLOCKED, SimpleNamespace(patient_safety_rules=rules)) is not None
    # 只检查被喂进来的候选（都是患者输出）；学生原话从未传给规则库
    assert all(line != STUDENT_LINE for line in rules.seen)


# ── V1：最终候选命中 ───────────────────────────────────────────────────────


def test_v1_blocked_reply_is_not_persisted_and_student_line_survives(pg_session, record_factory):
    from models import Message

    db = pg_session
    record, user = record_factory()
    claim = begin_turn(db, record=record, request_id="v1-blocked", content=STUDENT_LINE)
    app_state = SimpleNamespace(llm_client=StubLLM([PATIENT_BLOCKED]), patient_safety_rules=StubRules(PATIENT_BLOCKED))
    ctx = _ctx(db, record, user, app_state, claim=claim)

    async def _run() -> None:
        await llm_caller(ctx)
        await persister(ctx)

    asyncio.run(_run())

    assert ctx.error_code == SAFETY_BLOCKED_CODE
    assert ctx.error == SAFETY_BLOCKED_MESSAGE
    assert ctx.llm_reply is None
    assert ctx.state.get(STATE_SAVED_MESSAGES) in (None, [])

    db.expire_all()
    rows = db.query(Message).filter(Message.record_id == record.id).all()
    assert [(m.role, m.content) for m in rows] == [("student", STUDENT_LINE)]
    assert claim.status == "failed"
    assert claim.error_code == SAFETY_BLOCKED_CODE
    assert claim.patient_message_id is None


def test_v1_blocked_reply_is_not_pushed_to_stream(pg_session, record_factory):
    db = pg_session
    record, user = record_factory()
    claim = begin_turn(db, record=record, request_id="v1-stream", content=STUDENT_LINE)
    app_state = SimpleNamespace(llm_client=StubLLM([PATIENT_BLOCKED]), patient_safety_rules=StubRules(PATIENT_BLOCKED))
    queue: asyncio.Queue[str] = asyncio.Queue()
    ctx = _ctx(db, record, user, app_state, claim=claim, stream=True, queue=queue)

    async def _run() -> None:
        await llm_caller(ctx)
        await persister(ctx)

    asyncio.run(_run())

    assert queue.empty()
    assert ctx.error_code == SAFETY_BLOCKED_CODE


def test_v1_checks_the_corrected_candidate_not_just_the_first_output(pg_session, record_factory):
    """身份守卫触发重试，**修正后的候选**才是红线检查对象。"""
    db = pg_session
    record, user = record_factory()
    claim = begin_turn(db, record=record, request_id="v1-retry", content=STUDENT_LINE)
    # 首轮自曝 AI 身份 → 触发一次修正重试；重试结果命中红线
    app_state = SimpleNamespace(
        llm_client=StubLLM(["其实我是人工智能，可以帮你安排后续。", PATIENT_BLOCKED]),
        patient_safety_rules=StubRules(PATIENT_BLOCKED),
    )
    ctx = _ctx(db, record, user, app_state, claim=claim)
    ctx.llm_messages = [{"role": "system", "content": "患者人设"}]

    async def _run() -> None:
        await llm_caller(ctx)
        await persister(ctx)

    asyncio.run(_run())

    assert ctx.state.get(STATE_LEAK_CORRECTION_COUNT) == 1
    assert ctx.error_code == SAFETY_BLOCKED_CODE
    assert app_state.patient_safety_rules.seen == [PATIENT_BLOCKED]
    assert ctx.llm_reply is None


def test_v1_allows_clean_reply(pg_session, record_factory):
    from models import Message

    db = pg_session
    record, user = record_factory()
    claim = begin_turn(db, record=record, request_id="v1-ok", content=STUDENT_LINE)
    app_state = SimpleNamespace(llm_client=StubLLM([PATIENT_OK]), patient_safety_rules=StubRules(PATIENT_BLOCKED))
    ctx = _ctx(db, record, user, app_state, claim=claim)

    async def _run() -> None:
        await llm_caller(ctx)
        await persister(ctx)

    asyncio.run(_run())

    assert ctx.error_code is None
    db.expire_all()
    rows = db.query(Message).filter(Message.record_id == record.id).order_by(Message.id).all()
    assert [(m.role, m.content) for m in rows] == [("student", STUDENT_LINE), ("patient", PATIENT_OK)]


# ── 修正：命中不得替换原消息 ───────────────────────────────────────────────


def test_correction_hit_keeps_original_pair(pg_session, record_factory):
    from models import Message

    db = pg_session
    record, user = record_factory()
    original_student = Message(record_id=record.id, role="student", content="原问题")
    original_patient = Message(record_id=record.id, role="patient", content="原回复")
    db.add_all([original_student, original_patient])
    db.flush()

    app_state = SimpleNamespace(llm_client=StubLLM([PATIENT_BLOCKED]), patient_safety_rules=StubRules(PATIENT_BLOCKED))
    ctx = _ctx(
        db,
        record,
        user,
        app_state,
        correction={"student": original_student, "patient": original_patient},
    )

    asyncio.run(llm_caller(ctx))
    asyncio.run(persister(ctx))

    assert ctx.error_code == SAFETY_BLOCKED_CODE
    db.expire_all()
    rows = db.query(Message).filter(Message.record_id == record.id).order_by(Message.id).all()
    # 原问答原封不动；拦截后的候选文本一个字都没进来
    assert [(m.id, m.role, m.content) for m in rows] == [
        (original_student.id, "student", "原问题"),
        (original_patient.id, "patient", "原回复"),
    ]
    assert ctx.state.get(STATE_LEAK_CORRECTION_COUNT) in (None, 0)


def test_correction_hit_surfaces_stable_code(pg_session, record_factory):
    """修正命中后客户端拿到的是稳定错误码，而不是"成功但只是没变"。"""
    from models import Message

    db = pg_session
    record, user = record_factory()
    original_student = Message(record_id=record.id, role="student", content="原问题")
    original_patient = Message(record_id=record.id, role="patient", content="原回复")
    db.add_all([original_student, original_patient])
    db.flush()

    app_state = SimpleNamespace(llm_client=StubLLM([PATIENT_BLOCKED]), patient_safety_rules=StubRules(PATIENT_BLOCKED))
    ctx = _ctx(
        db,
        record,
        user,
        app_state,
        correction={"student": original_student, "patient": original_patient},
    )

    asyncio.run(llm_caller(ctx))
    assert ctx.error_code == SAFETY_BLOCKED_CODE
    assert ctx.error == SAFETY_BLOCKED_MESSAGE
    # 修正上下文没有 turn claim：persister 不能因缺 claim 报错，只能安静保留原样
    asyncio.run(persister(ctx))
    assert ctx.error_code == SAFETY_BLOCKED_CODE
    assert ctx.state.get(STATE_SAVED_MESSAGES) is None


def test_batch_candidate_checked_even_without_prompt_messages(pg_session, record_factory):
    """没有提示词可加修正片段时（``llm_messages is None``），原回复仍要被红线检查。"""
    db = pg_session
    record, user = record_factory()
    claim = begin_turn(db, record=record, request_id="v1-no-prompt", content=STUDENT_LINE)
    app_state = SimpleNamespace(
        llm_client=StubLLM(["其实我是人工智能，可以帮你安排后续。"]),
        patient_safety_rules=StubRules("其实我是人工智能，可以帮你安排后续。"),
    )
    ctx = _ctx(db, record, user, app_state, claim=claim)
    assert ctx.llm_messages is None

    asyncio.run(llm_caller(ctx))

    # 泄漏 + 无提示词 → 沿用原回复，但绝不跳过红线
    assert ctx.error_code == SAFETY_BLOCKED_CODE
    assert ctx.llm_reply is None


# ── V2：filter 之后、persist 之前 ──────────────────────────────────────────


def _clinical_ctx(db, record_factory, *, app_state, case_data):
    record, user = record_factory(workflow_id="clinical_reasoning")
    claim = begin_turn(db, record=record, request_id="v2-turn", content=STUDENT_LINE)
    ctx = PipelineContext(
        record=record,
        case_data=case_data,
        current_user=user,
        db=db,
        app_state=app_state,
        student_input=STUDENT_LINE,
        messages=message_views([]),
    )
    ctx.state[STATE_TURN] = claim
    return record, claim, ctx


def test_v2_blocked_reply_fails_turn_without_persisting(pg_session, record_factory, case_data):
    from fastapi import HTTPException

    from models import Message
    from modules.training.clinical_reasoning import run_clinical_reasoning_turn

    db = pg_session

    class JsonLLM:
        async def call_json(self, messages, **kwargs):
            return {"reply": PATIENT_BLOCKED, "disclosed_findings": [], "communicated_objectives": []}

    app_state = SimpleNamespace(llm_client=JsonLLM(), patient_safety_rules=StubRules(PATIENT_BLOCKED))
    record, claim, ctx = _clinical_ctx(db, record_factory, app_state=app_state, case_data=case_data)
    runtime_before = dict(record.runtime_state or {})

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(run_clinical_reasoning_turn(ctx))

    detail = excinfo.value.detail
    assert excinfo.value.status_code == 503
    assert detail["code"] == SAFETY_BLOCKED_CODE
    assert detail["message"] == SAFETY_BLOCKED_MESSAGE
    assert detail["turn_id"] == claim.turn_id
    assert detail["student_message_id"] == claim.student_message_id

    db.expire_all()
    rows = db.query(Message).filter(Message.record_id == record.id).all()
    assert [(m.role, m.content) for m in rows] == [("student", STUDENT_LINE)]
    # 没有患者消息 → 证据/沟通状态也不应前进
    assert (db.get(type(record), record.id).runtime_state or {}) == runtime_before


# ── 主动追问：丢弃即止 ─────────────────────────────────────────────────────


def test_initiative_hit_is_discarded_and_not_triggered(pg_session, record_factory):
    """路由级：主动追问命中红线 → 不写患者消息、返回 triggered=false。"""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from core.database import get_db
    from core.security import get_current_user
    from models import Message
    from modules.training.router import progress as progress_router

    db = pg_session
    record, user = record_factory(runtime_state={"features": {"patient_initiative": True}})

    async def _initiative(*_a, **_k):
        return PATIENT_BLOCKED

    class _Cache:
        """绕过限流/冷却：只为走到"生成之后"的守卫。"""

        def __getattr__(self, name):
            return lambda *a, **k: None

    app = FastAPI()
    app.state.llm_client = SimpleNamespace()
    app.state.initiative_cache = _Cache()
    app.state.patient_safety_rules = StubRules(PATIENT_BLOCKED)
    app.include_router(progress_router.router, prefix="/api/progress")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user

    monkeypatch_targets = {
        "is_feature_enabled": lambda rec, key: True,
        "can_initiate": lambda *a, **k: (True, "ok"),
        "derive_initiative_policy": lambda *a, **k: SimpleNamespace(),
        "generate_initiative_llm": _initiative,
    }
    originals = {name: getattr(progress_router, name) for name in monkeypatch_targets}
    for name, fn in monkeypatch_targets.items():
        setattr(progress_router, name, fn)
    try:
        client = TestClient(app)
        resp = client.post(f"/api/progress/{record.id}/initiative/trigger")
    finally:
        for name, fn in originals.items():
            setattr(progress_router, name, fn)

    assert resp.status_code == 200
    body = resp.json()
    assert body["triggered"] is False
    assert body["message"] is None
    db.expire_all()
    assert db.query(Message).filter(Message.record_id == record.id).count() == 0
