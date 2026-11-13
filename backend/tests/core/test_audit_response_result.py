"""每次 `/api/` 请求 ↔ 真实 HTTP 结果的判据（**真实 PG**，`nursing_test`）。

`audit_logs` 是只追加表，"这次请求最终回了什么状态码"只能等响应生成后单独记。
本文件钉住 `core/audit.py::attach_response_status()` 的语义：

- **有审计事件**：每个已提交的事件一行（201 成功、403/500 失败都一样），且不改 `outcome`；
- **没有审计事件**（普通 GET / 纯读取 POST）：写一行 `audit_log_id IS NULL` —— 没有审计的
  接口同样要能回答"它回了什么状态码"；
- 被业务回滚的事件（库里没有行）不得留下结果；
- 历史行（没有结果）可读，`response_status is None`；
- 幂等：同一请求实例重复 attach、同一事件重复投递都只跳过；
- `request_key` 是服务端生成的请求实例键，客户端重复的 `X-Request-ID` 不会串结果；
- 写入失败只记日志，不影响业务响应（中间件的调用点不抛）。
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

from core.audit import (
    ACTION_ACCESS_DENIED,
    ACTION_USER_CREATED,
    TARGET_TYPE_USER,
    attach_response_status,
    record,
    record_detached,
    request_key,
)
from core.database import Base, SessionLocal
from core.database import engine as pg_engine
from models import AuditLog, AuditResponseResult, User

_TABLES = [User.__table__, AuditLog.__table__, AuditResponseResult.__table__]

#: 本文件创建的 request_id 前缀 → teardown 按它清干净
_RID_PREFIX = "ar-"


@pytest.fixture(scope="module", autouse=True)
def _schema():
    Base.metadata.create_all(pg_engine, tables=_TABLES)


@pytest.fixture
def db():
    """**真提交**的会话：`attach_response_status` 用独立 `SessionLocal()`，
    savepoint 夹具里未提交的 actor/事件对它不可见（那是夹具形态，不是产品行为）。
    因此本文件自带清理，而不是靠 `pg_session` 回滚。"""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture(autouse=True)
def _cleanup_rows():
    yield
    with SessionLocal() as db:
        audit_ids = [row[0] for row in db.query(AuditLog.id).filter(AuditLog.request_id.like(f"{_RID_PREFIX}%")).all()]
        if audit_ids:
            db.query(AuditResponseResult).filter(AuditResponseResult.audit_log_id.in_(audit_ids)).delete(
                synchronize_session=False
            )
            db.query(AuditLog).filter(AuditLog.id.in_(audit_ids)).delete(synchronize_session=False)
        # 无事件的结果行没有 audit_log_id，靠 request_id 前缀清
        db.query(AuditResponseResult).filter(AuditResponseResult.request_id.like(f"{_RID_PREFIX}%")).delete(
            synchronize_session=False
        )
        db.commit()


def _request(rid: str | None = None, *, method: str = "POST", path: str = "/api/admin/users"):
    return SimpleNamespace(
        state=SimpleNamespace(request_id=rid or f"{_RID_PREFIX}{uuid.uuid4().hex[:10]}", audit_actor=None),
        headers={"user-agent": "pytest"},
        method=method,
        url=SimpleNamespace(path=path),
    )


def _result(db, audit_log_id: int) -> AuditResponseResult | None:
    return db.query(AuditResponseResult).filter(AuditResponseResult.audit_log_id == audit_log_id).first()


def _results_for(db, request) -> list[AuditResponseResult]:
    return db.query(AuditResponseResult).filter(AuditResponseResult.request_key == request_key(request)).all()


def test_success_audit_gets_real_201_status(db):
    request = _request()
    entry = record(db, action=ACTION_USER_CREATED, target_type=TARGET_TYPE_USER, target_id=7, request=request)
    db.commit()
    assert entry.id is not None

    assert attach_response_status(request, 201) == 1

    result = _result(db, entry.id)
    assert result is not None
    assert result.status_code == 201
    # 结果行自带请求上下文（排障时不必再回连 audit_logs）
    assert result.request_id == request.state.request_id
    assert (result.request_method, result.request_path) == ("POST", "/api/admin/users")
    # 旧字段保持原样：outcome 仍由调用点决定，状态码不参与推导
    assert db.get(AuditLog, entry.id).outcome == "success"


def test_failure_response_status_is_recorded_verbatim(db):
    """403 / 500 都按真实状态码落结果；`outcome` 不被改写。"""
    request = _request()
    denied = record(
        db,
        action=ACTION_ACCESS_DENIED,
        target_type=TARGET_TYPE_USER,
        request=request,
        outcome="denied",
    )
    db.commit()
    attach_response_status(request, 403)

    failure_request = _request()
    failure = record(
        db,
        action=ACTION_USER_CREATED,
        target_type=TARGET_TYPE_USER,
        request=failure_request,
        outcome="failure",
        error_detail="boom",
    )
    db.commit()
    attach_response_status(failure_request, 500)

    assert _result(db, denied.id).status_code == 403
    assert _result(db, failure.id).status_code == 500
    db.expire_all()
    assert db.get(AuditLog, denied.id).outcome == "denied"
    assert db.get(AuditLog, failure.id).outcome == "failure"
    assert db.get(AuditLog, failure.id).error_detail == "boom"


def test_multiple_events_in_one_request_all_get_status(db):
    request = _request()
    first = record(db, action=ACTION_USER_CREATED, target_type=TARGET_TYPE_USER, request=request)
    second = record(db, action="user.bulk_assigned", target_type=TARGET_TYPE_USER, request=request, outcome="denied")
    db.commit()

    assert attach_response_status(request, 207) == 2
    assert {_result(db, first.id).status_code, _result(db, second.id).status_code} == {207}
    # 两个事件 = 两行，没有额外补一条"请求本身"
    assert len(_results_for(db, request)) == 2


def test_plain_get_without_events_records_request_itself(db):
    """普通 GET 没有任何审计事件 → 也要留一行真实状态码（`audit_log_id IS NULL`）。"""
    request = _request(method="GET", path="/api/cases")

    assert attach_response_status(request, 200) == 1

    rows = _results_for(db, request)
    assert len(rows) == 1
    assert rows[0].audit_log_id is None
    assert rows[0].status_code == 200
    assert (rows[0].request_method, rows[0].request_path) == ("GET", "/api/cases")


def test_post_without_events_records_real_failure_status(db):
    """纯读取 POST 失败（404/422/500）同样记录真实状态码。"""
    for status in (404, 422, 500):
        request = _request(method="POST", path="/api/cases/query")
        assert attach_response_status(request, status) == 1
        rows = _results_for(db, request)
        assert [row.status_code for row in rows] == [status]
        assert rows[0].audit_log_id is None


def test_rolled_back_event_still_records_request_status(db):
    """事件全部被回滚：不关联任何事件，但**这次请求确实发生了**，必须留真实状态码。"""
    request = _request()
    record(db, action=ACTION_USER_CREATED, target_type=TARGET_TYPE_USER, request=request)
    # `record()` 只 flush 不 commit：事务仍归调用方，回滚后这行连同 id 一起消失
    assert request.state.audit_entries, "登记发生在写入时（提交前）"
    db.rollback()

    # 候选事件一个都没提交 → 写一条"请求本身"的结果（NULL 关联）
    assert attach_response_status(request, 500) == 1
    assert db.query(AuditLog).filter(AuditLog.request_id == request.state.request_id).count() == 0

    rows = _results_for(db, request)
    assert len(rows) == 1
    assert rows[0].audit_log_id is None, "回滚的事件不得被关联"
    assert rows[0].status_code == 500
    assert (rows[0].request_method, rows[0].request_path) == ("POST", "/api/admin/users")


def test_partially_committed_events_skip_the_request_row(db):
    """部分提交：只写提交了的事件行，不额外补一条 NULL 行。"""
    request = _request()
    committed = record(db, action=ACTION_USER_CREATED, target_type=TARGET_TYPE_USER, request=request)
    db.commit()
    rolled_back = record(db, action="user.bulk_assigned", target_type=TARGET_TYPE_USER, request=request)
    db.rollback()

    assert committed.id is not None
    assert rolled_back.id is not None  # flush 分配过 id，但回滚后行已不存在

    assert attach_response_status(request, 200) == 1
    rows = _results_for(db, request)
    assert len(rows) == 1
    assert rows[0].audit_log_id == committed.id
    assert rows[0].status_code == 200


def test_detached_event_survives_and_gets_status():
    """独立 session 的事件是真提交：中间件补结果时必须能找到它的行。"""
    request = _request()
    rid = request.state.request_id
    record_detached(request, action=ACTION_ACCESS_DENIED, target_type=TARGET_TYPE_USER)

    attach_response_status(request, 403)

    with SessionLocal() as check:
        row = check.query(AuditLog).filter(AuditLog.request_id == rid).one()
        result = check.query(AuditResponseResult).filter(AuditResponseResult.audit_log_id == row.id).one()
        assert result.status_code == 403
        # 独立 session 的 outcome 仍是调用点给的 denied，不因状态码改变
        assert row.outcome == "denied"


def test_attach_is_idempotent_per_event(db):
    request = _request()
    entry = record(db, action=ACTION_USER_CREATED, target_type=TARGET_TYPE_USER, request=request)
    db.commit()

    assert attach_response_status(request, 201) == 1
    assert attach_response_status(request, 500) == 0
    rows = db.query(AuditResponseResult).filter(AuditResponseResult.audit_log_id == entry.id).all()
    assert len(rows) == 1
    assert rows[0].status_code == 201


def test_non_event_request_is_idempotent(db):
    """没有事件的请求重复 attach：仍然只有一行，状态码保持首次真实值。"""
    request = _request(method="GET", path="/api/cases")

    assert attach_response_status(request, 200) == 1
    assert attach_response_status(request, 200) == 0
    rows = _results_for(db, request)
    assert len(rows) == 1
    assert rows[0].status_code == 200


def test_request_key_is_stable_and_server_generated(db):
    """`request_key` 惰性生成一次后写回 state：同一请求实例只用一个键。"""
    request = _request()

    first = request_key(request)
    assert first
    assert request_key(request) == first
    # 另一个请求实例（即使拿同一个 request_id）拿到不同的键
    same_rid = _request(request.state.request_id)
    assert request_key(same_rid) != first


def test_repeated_client_request_id_does_not_cross_results(db):
    """客户端重复发同一个 `X-Request-ID` 时，两个请求的状态码互不覆盖/串行。"""
    shared_rid = f"{_RID_PREFIX}{uuid.uuid4().hex[:10]}"
    first = _request(shared_rid)
    second = _request(shared_rid)
    assert request_key(first) != request_key(second)

    assert attach_response_status(first, 200) == 1
    assert attach_response_status(second, 500) == 1

    with SessionLocal() as check:
        rows = check.query(AuditResponseResult).filter(AuditResponseResult.request_id == shared_rid).all()
        assert sorted(row.status_code for row in rows) == [200, 500]
        assert len({row.request_key for row in rows}) == 2


def test_historical_row_without_result_is_readable(db):
    """历史行（本功能上线前写入）没有结果行：不得报错，读出来就是 None。"""
    old = AuditLog(
        action=ACTION_USER_CREATED,
        target_type=TARGET_TYPE_USER,
        payload={},
        request_id=f"{_RID_PREFIX}{uuid.uuid4().hex[:10]}",
    )
    db.add(old)
    db.commit()

    assert _result(db, old.id) is None
    # 中间件只处理本次请求登记的事件，历史事件不会被顺手补上
    attach_response_status(_request(), 200)
    assert _result(db, old.id) is None


def test_none_request_does_nothing():
    assert attach_response_status(None, 200) == 0


def test_unreachable_candidate_falls_back_to_request_row(db):
    """候选 id 在库里不存在（如被回滚/被清理）：不得拿它去写结果，而应退化成请求行。"""
    request = _request()
    missing_id = 10**18  # 库里没有这条 audit_logs 行
    request.state.audit_entries = [missing_id]

    assert attach_response_status(request, 500) == 1
    rows = _results_for(db, request)
    assert [row.audit_log_id for row in rows] == [None]
    assert rows[0].status_code == 500


def test_write_failure_is_swallowed(db):
    """结果写入失败只记日志：`attach_response_status` 不抛，业务响应照常返回。"""
    from core.database import SessionLocal as _RealSessionLocal

    class _Broken:
        def __init__(self):
            self._inner = _RealSessionLocal()

        def __getattr__(self, name):
            return getattr(self._inner, name)

        def commit(self):
            self._inner.rollback()
            raise RuntimeError("audit_response_results unavailable")

    from core import database as db_module

    original = db_module.SessionLocal
    db_module.SessionLocal = _Broken
    try:
        request = _request()
        assert attach_response_status(request, 500) == 0
    finally:
        db_module.SessionLocal = original


def test_result_model_is_insert_only():
    """结果表不提供更新语义：没有 updated_at，也没有 update/delete 调用点。"""
    assert "updated_at" not in AuditResponseResult.__table__.columns
    import re
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    offenders: list[str] = []
    for path in list((root / "modules").rglob("*.py")) + [root / "core" / "audit.py"]:
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if "AuditResponseResult" not in line and "audit_response_results" not in line:
                continue
            if re.search(r"\b(delete|update)\s*\(", line):
                offenders.append(f"{path}:{lineno}: {line.strip()}")
    assert not offenders, "发现对审计结果的写改删：\n" + "\n".join(offenders)
