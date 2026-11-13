"""审计列表 / 导出里的 `response_status`（真实 PG）。

判据：
- 列表一次批量读本页状态码（不做 N+1 —— 用语句计数钉住"只多一条查询"）；
- 历史行没有结果 → `response_status is None`，不是 0、不是 200；
- 导出把真实 HTTP 状态写成独立一列，历史行为空列；
- 状态码不进 `outcome`（不据状态码推断业务结果，反之亦然）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event

from core.audit import ACTION_USER_CREATED, ACTION_USER_DELETED
from core.database import Base, SessionLocal
from core.database import engine as pg_engine
from core.deps import get_db
from core.security import get_current_user
from models import AuditLog, AuditResponseResult, User
from modules.admin.audit_logs import router as audit_router

_TABLES = [User.__table__, AuditLog.__table__, AuditResponseResult.__table__]


@pytest.fixture(scope="module", autouse=True)
def _schema():
    Base.metadata.create_all(pg_engine, tables=_TABLES)


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(audit_router, prefix="/api/admin")

    def _db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    viewer = User(username="audit-viewer", password_hash="x")
    viewer.set_permissions_cache({"audit_view", "audit_export"})
    app.dependency_overrides[get_db] = _db
    # 权限闸靠真实 `require_permission`（`_Viewer` 是 `Annotated[..., Depends(checker)]`，
    # 只能绕过它的底层依赖 `get_current_user`）
    app.dependency_overrides[get_current_user] = lambda: viewer
    return TestClient(app)


def _seed(tag: str) -> tuple[int, int]:
    """建两条审计：一条带真实结果（201），一条历史无结果。返回 (带结果 id, 无结果 id)。"""
    with SessionLocal() as db:
        with_result = AuditLog(
            action=f"{ACTION_USER_CREATED}.{tag}",
            target_type="user",
            outcome="success",
            payload={},
            created_at=datetime.now(UTC),
        )
        historical = AuditLog(
            action=f"{ACTION_USER_DELETED}.{tag}",
            target_type="user",
            outcome="denied",
            payload={},
            created_at=datetime.now(UTC),
        )
        db.add_all([with_result, historical])
        db.flush()
        db.add(
            AuditResponseResult(
                audit_log_id=with_result.id,
                request_key=uuid.uuid4().hex[:32],
                status_code=201,
            )
        )
        db.commit()
        return with_result.id, historical.id


def _cleanup(tag: str) -> None:
    with SessionLocal() as db:
        ids = [r.id for r in db.query(AuditLog).filter(AuditLog.action.like(f"%{tag}%")).all()]
        if ids:
            db.query(AuditResponseResult).filter(AuditResponseResult.audit_log_id.in_(ids)).delete(
                synchronize_session=False
            )
            db.query(AuditLog).filter(AuditLog.id.in_(ids)).delete(synchronize_session=False)
        db.commit()


def test_list_reports_real_status_and_none_for_history():
    tag = uuid.uuid4().hex[:8]
    with_result_id, historical_id = _seed(tag)
    try:
        resp = _client().get("/api/admin/audit-logs", params={"search": tag, "limit": 50})
        assert resp.status_code == 200, resp.text
        items = {i["id"]: i for i in resp.json()["items"]}

        assert items[with_result_id]["response_status"] == 201
        assert items[with_result_id]["outcome"] == "success"
        # 历史行可读，状态码为 None（不伪造 200）
        assert items[historical_id]["response_status"] is None
        # 状态码不参与 outcome
        assert items[historical_id]["outcome"] == "denied"
    finally:
        _cleanup(tag)


def test_list_reads_results_in_one_batch_query():
    """本页状态码只查一次：不做 N+1（按条查会是 3 条以上）。"""
    tag = uuid.uuid4().hex[:8]
    ids = []
    with SessionLocal() as db:
        for i in range(3):
            row = AuditLog(action=f"{ACTION_USER_CREATED}.{tag}.{i}", target_type="user", payload={})
            db.add(row)
            db.flush()
            ids.append(row.id)
            db.add(
                AuditResponseResult(
                    audit_log_id=row.id,
                    request_key=uuid.uuid4().hex[:32],
                    status_code=201,
                )
            )
        db.commit()

    statements: list[str] = []

    def _capture(conn, cursor, statement, parameters, context, executemany):
        if "audit_response_results" in statement:
            statements.append(statement)

    try:
        event.listen(pg_engine, "before_cursor_execute", _capture)
        resp = _client().get("/api/admin/audit-logs", params={"search": tag, "limit": 50})
        assert resp.status_code == 200, resp.text
        assert len(resp.json()["items"]) == 3
        assert {i["response_status"] for i in resp.json()["items"]} == {201}
        assert len(statements) == 1, statements
    finally:
        if event.contains(pg_engine, "before_cursor_execute", _capture):
            event.remove(pg_engine, "before_cursor_execute", _capture)
        _cleanup(tag)


def test_export_has_http_status_column_and_blank_for_history():
    tag = uuid.uuid4().hex[:8]
    _seed(tag)
    try:
        resp = _client().post("/api/admin/audit-logs/export", params={"search": tag, "format": "csv"})
        assert resp.status_code == 200, resp.text
        text = resp.content.decode("utf-8-sig")
        lines = [ln for ln in text.splitlines() if tag in ln]
        assert len(lines) == 2, text

        header = text.splitlines()[0]
        assert "HTTP 状态" in header
        status_idx = header.split(",").index("HTTP 状态")
        statuses = {ln.split(",")[status_idx] for ln in lines}
        # 一条真实 201，一条历史空列（不是 0、不是 200）
        assert statuses == {"201", ""}
    finally:
        _cleanup(tag)


def test_event_less_request_rows_do_not_leak_into_audit_list():
    """没有审计事件的请求结果（`audit_log_id IS NULL`）不属于任何审计行，不得混进列表。"""
    tag = uuid.uuid4().hex[:8]
    with SessionLocal() as db:
        db.add(
            AuditResponseResult(
                audit_log_id=None,
                request_key=uuid.uuid4().hex[:32],
                request_id=f"rid-{tag}",
                request_method="GET",
                request_path=f"/api/cases?tag={tag}",
                status_code=500,
            )
        )
        db.commit()
    try:
        resp = _client().get("/api/admin/audit-logs", params={"search": f"rid-{tag}", "limit": 50})
        assert resp.status_code == 200, resp.text
        # 只按 audit_logs 匹配：这条 request_id 没有对应审计行 → 列表为空
        assert resp.json()["items"] == []
    finally:
        with SessionLocal() as db:
            db.query(AuditResponseResult).filter(AuditResponseResult.request_id == f"rid-{tag}").delete()
            db.commit()
