"""端到端：中间件为**每次 `/api/` 业务请求**记录真实响应状态码（真实 PG + 真实中间件）。

前面两个文件分别钉住 writer 与查询口径；这里钉住接线本身：
`main._log_requests` 在 response 生成后调用 `core.audit.attach_response_status`。

因此用例直接挂 **`main.app` 的真实中间件**，但用一份最小 app 承载路由
（真实 app 的 lifespan 会跑 seed / schema 校验，不是本判据的对象）：

- 成功业务审计（201/200）→ 结果行带上真实状态码；
- 失败响应（403/500）→ 记录真实状态码，`audit_logs.outcome` 保持不变；
- **没有任何审计事件**的普通 GET / 纯读取 POST → 也写一行（`audit_log_id IS NULL`）；
- `/api/health`、`/api/metrics` 探针与 `/api/diagnose` 诊断接口不写；非 `/api/` 路径不写；
- 客户端重复的 `X-Request-ID` 不会让两个请求的状态码串在一起；
- 事件被业务回滚 → 不关联该事件，但仍留这次请求的真实状态码；
- 审计结果写入失败不得影响业务响应（中间件吞掉异常，仍返回原状态码）。
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import TYPE_CHECKING

import pytest
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

import main as main_module
from core.audit import TARGET_TYPE_SCHOOL, record
from core.database import Base, SessionLocal
from core.database import engine as pg_engine
from core.deps import get_db
from models import AuditLog, AuditResponseResult, School, User

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

_TABLES = [User.__table__, School.__table__, AuditLog.__table__, AuditResponseResult.__table__]


@pytest.fixture(scope="module", autouse=True)
def _schema():
    Base.metadata.create_all(pg_engine, tables=_TABLES)


@pytest.fixture(autouse=True)
def _cleanup_rows():
    yield
    with SessionLocal() as db:
        audit_ids = [row[0] for row in db.query(AuditLog.id).filter(AuditLog.action.like("e2e.%")).all()]
        if audit_ids:
            db.query(AuditResponseResult).filter(AuditResponseResult.audit_log_id.in_(audit_ids)).delete(
                synchronize_session=False
            )
            db.query(AuditLog).filter(AuditLog.id.in_(audit_ids)).delete(synchronize_session=False)
        # 无事件的结果行没有 audit_log_id，按测试请求路径清
        db.query(AuditResponseResult).filter(AuditResponseResult.request_path.like("/api/e2e%")).delete(
            synchronize_session=False
        )
        db.commit()


def _probe() -> dict:
    return {"ok": True}


def _client(route) -> TestClient:
    """最小 app + **真实** `main._log_requests` 与 `main._request_id` 中间件。

    `_request_id` 必须在：审计行/结果都按 `request.state.request_id` 关联
    （真实 app 里它同样装在 `_log_requests` 内侧）。
    """
    app = FastAPI()

    def _db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _db
    # 真实 app 的兜底处理器：未捕获异常 → 500 JSON（`_log_requests` 记录/断言的就是它）。
    # 以**普通依赖**形态注册（等价于生产行为），Starlette 才会在中间件内侧把它变成响应，
    # 而不是让异常一路冒到 `ServerErrorMiddleware`（那层在用户中间件外面）。
    app.add_exception_handler(RuntimeError, main_module.global_exception_handler)
    app.middleware("http")(main_module._log_requests)
    app.middleware("http")(main_module._request_id)
    app.add_api_route("/api/e2e", route, methods=["POST", "GET"])
    app.add_api_route("/api/health", _probe, methods=["GET"])
    app.add_api_route("/api/metrics", _probe, methods=["GET"])
    app.add_api_route("/api/diagnose", _probe, methods=["GET"])
    # 真实部署里 500 是**响应**；TestClient 默认把服务端异常重新抛出，
    # 那样中间件根本走不到"拿到 response 后补状态码"的分支。
    return TestClient(app, raise_server_exceptions=False)


def _all_results_for_rid(rid: str) -> list[SimpleNamespace]:
    with SessionLocal() as db:
        rows = db.query(AuditResponseResult).filter(AuditResponseResult.request_id == rid).all()
        return [
            SimpleNamespace(
                audit_log_id=r.audit_log_id,
                request_key=r.request_key,
                status_code=r.status_code,
                request_method=r.request_method,
                request_path=r.request_path,
            )
            for r in rows
        ]


def _result_for(rid: str) -> tuple[SimpleNamespace, SimpleNamespace | None]:
    """读回这条请求的审计行与其结果（脱离会话的纯值，避免出作用域后过期）。"""
    with SessionLocal() as db:
        row = db.query(AuditLog).filter(AuditLog.request_id == rid).one()
        result = db.query(AuditResponseResult).filter(AuditResponseResult.audit_log_id == row.id).first()
        return (
            SimpleNamespace(outcome=row.outcome, error_detail=row.error_detail),
            None if result is None else SimpleNamespace(status_code=result.status_code),
        )


def test_201_response_attaches_status():
    rid = f"e2e-{uuid.uuid4().hex[:10]}"

    def route(request: Request, db: Session = Depends(get_db)):
        entry = record(db, action="e2e.success", target_type=TARGET_TYPE_SCHOOL, request=request)
        assert entry.id is not None
        db.commit()
        return {"ok": True}

    client = _client(route)
    resp = client.post("/api/e2e", headers={"X-Request-ID": rid})
    assert resp.status_code == 200, resp.text

    row, result = _result_for(rid)
    assert row.outcome == "success"
    assert result is not None
    assert result.status_code == 200


def test_403_response_attaches_real_status():
    rid = f"e2e-{uuid.uuid4().hex[:10]}"

    def route(request: Request, db: Session = Depends(get_db)):
        record(db, action="e2e.denied", target_type=TARGET_TYPE_SCHOOL, request=request, outcome="denied")
        db.commit()
        raise HTTPException(status_code=403, detail="权限不足")

    client = _client(route)
    resp = client.post("/api/e2e", headers={"X-Request-ID": rid})
    assert resp.status_code == 403

    row, result = _result_for(rid)
    assert row.outcome == "denied"  # 不被状态码改写
    assert result is not None
    assert result.status_code == 403


def test_500_response_attaches_real_status():
    rid = f"e2e-{uuid.uuid4().hex[:10]}"

    def route(request: Request, db: Session = Depends(get_db)):
        record(
            db,
            action="e2e.failure",
            target_type=TARGET_TYPE_SCHOOL,
            request=request,
            outcome="failure",
            error_detail="boom",
        )
        db.commit()
        raise RuntimeError("boom")

    client = _client(route)
    resp = client.post("/api/e2e", headers={"X-Request-ID": rid})
    assert resp.status_code == 500
    assert resp.json() == {"detail": "服务器内部错误"}

    row, result = _result_for(rid)
    assert (row.outcome, row.error_detail) == ("failure", "boom")
    assert result is not None
    assert result.status_code == 500


def test_rolled_back_event_still_records_request_status():
    """事件被业务回滚：不关联该事件，但这次请求本身仍要留下真实状态码。"""
    rid = f"e2e-{uuid.uuid4().hex[:10]}"

    def route(request: Request, db: Session = Depends(get_db)):
        record(db, action="e2e.rolled_back", target_type=TARGET_TYPE_SCHOOL, request=request)
        db.rollback()
        raise HTTPException(status_code=409, detail="冲突")

    client = _client(route)
    assert client.post("/api/e2e", headers={"X-Request-ID": rid}).status_code == 409

    with SessionLocal() as db:
        assert db.query(AuditLog).filter(AuditLog.request_id == rid).count() == 0
        rows = db.query(AuditResponseResult).filter(AuditResponseResult.request_id == rid).all()
        assert len(rows) == 1
        assert rows[0].audit_log_id is None, "回滚的事件不得被关联"
        assert rows[0].status_code == 409
        assert (rows[0].request_method, rows[0].request_path) == ("POST", "/api/e2e")


def test_audit_result_write_failure_does_not_break_response(monkeypatch):
    """审计结果写不进去（如库暂不可用）也不得改变业务响应。"""
    from core.database import SessionLocal as _RealSessionLocal

    class _BrokenResultSession:
        """真实会话，但写结果那一步失败（模拟结果表暂不可写）。"""

        def __init__(self):
            self._inner = _RealSessionLocal()

        def __getattr__(self, name):
            return getattr(self._inner, name)

        def commit(self):
            self._inner.rollback()
            raise RuntimeError("audit_response_results unavailable")

    # `get_db` 也走 `SessionLocal`（业务侧必须照常），所以只在"查过结果键之后"才坏：
    # `attach_response_status` 在函数内 `from core.database import SessionLocal`，
    # 补丁落在模块属性上才会被它看到。
    def _factory():
        return _BrokenResultSession()

    monkeypatch.setattr("core.database.SessionLocal", _factory)
    rid = f"e2e-{uuid.uuid4().hex[:10]}"

    def route(request: Request, db: Session = Depends(get_db)):
        record(db, action="e2e.broken_attach", target_type=TARGET_TYPE_SCHOOL, request=request)
        db.commit()
        return {"ok": True}

    client = _client(route)
    resp = client.post("/api/e2e", headers={"X-Request-ID": rid})
    assert resp.status_code == 200, resp.text

    row, result = _result_for(rid)
    assert row.outcome == "success"
    assert result is None


def test_plain_get_without_audit_records_request_status():
    """没有任何审计事件的普通 GET 也要留一行真实状态码。"""
    rid = f"e2e-{uuid.uuid4().hex[:10]}"

    def route() -> dict:
        return {"ok": True}

    resp = _client(route).get("/api/e2e", headers={"X-Request-ID": rid})
    assert resp.status_code == 200

    rows = _all_results_for_rid(rid)
    assert len(rows) == 1
    assert rows[0].audit_log_id is None
    assert rows[0].status_code == 200
    assert (rows[0].request_method, rows[0].request_path) == ("GET", "/api/e2e")


def test_post_without_audit_records_real_failure_status():
    """纯读取 POST 失败同样记录真实状态码（403 不是 200，也不是 0）。"""
    rid = f"e2e-{uuid.uuid4().hex[:10]}"

    def route() -> dict:
        raise HTTPException(status_code=403, detail="权限不足")

    resp = _client(route).post("/api/e2e", headers={"X-Request-ID": rid})
    assert resp.status_code == 403

    rows = _all_results_for_rid(rid)
    assert [row.status_code for row in rows] == [403]
    assert rows[0].audit_log_id is None


def test_unhandled_exception_without_audit_records_500():
    """未捕获异常（中间件内侧没有 response 对象）也留 500。"""
    rid = f"e2e-{uuid.uuid4().hex[:10]}"

    def route() -> dict:
        raise RuntimeError("boom")

    resp = _client(route).post("/api/e2e", headers={"X-Request-ID": rid})
    assert resp.status_code == 500

    rows = _all_results_for_rid(rid)
    assert [row.status_code for row in rows] == [500]


def test_health_metrics_and_diagnose_are_not_recorded():
    """高频探针与独立诊断接口不写结果表。"""
    client = _client(lambda: {"ok": True})
    for path in ("/api/health", "/api/metrics", "/api/diagnose"):
        rid = f"e2e-{uuid.uuid4().hex[:10]}"
        assert client.get(path, headers={"X-Request-ID": rid}).status_code == 200
        assert _all_results_for_rid(rid) == []


def test_non_api_paths_are_not_recorded():
    """只有 `/api/` 业务请求进结果表；静态/文档路径不进。"""
    rid = f"e2e-{uuid.uuid4().hex[:10]}"
    client = _client(lambda: {"ok": True})
    client.get("/api/e2e", headers={"X-Request-ID": rid})
    assert len(_all_results_for_rid(rid)) == 1

    other_rid = f"e2e-{uuid.uuid4().hex[:10]}"
    # 未注册的非 /api 路径同样会走中间件（404），但不应留下结果
    assert client.get("/openapi.json", headers={"X-Request-ID": other_rid}).status_code in (200, 404)
    assert _all_results_for_rid(other_rid) == []


def test_repeated_client_request_id_does_not_cross_status():
    """客户端重复同一个 `X-Request-ID`：两个请求各自留自己真实的状态码。"""
    rid = f"e2e-{uuid.uuid4().hex[:10]}"

    def ok() -> dict:
        return {"ok": True}

    def denied() -> dict:
        raise HTTPException(status_code=403, detail="权限不足")

    assert _client(ok).get("/api/e2e", headers={"X-Request-ID": rid}).status_code == 200
    assert _client(denied).post("/api/e2e", headers={"X-Request-ID": rid}).status_code == 403

    rows = _all_results_for_rid(rid)
    assert sorted(row.status_code for row in rows) == [200, 403]
    assert len({row.request_key for row in rows}) == 2, "两个请求实例必须各有自己的 request_key"
