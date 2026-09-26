"""request_id 中间件的端到端判据：每个响应都带 X-Request-ID，且请求态可被审计读取。

背景：`modules/qa/router/endpoints.py` 早已读取 `request.state.request_id`，但全仓没有赋值点
→ 恒为 None（死读取）；审计行要靠它与 access 日志双向关联（2026-09-26 审计研究 §3.2）。
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app


def _client() -> TestClient:
    return TestClient(app, raise_server_exceptions=False)


def test_response_carries_generated_request_id():
    resp = _client().get("/api/health")
    rid = resp.headers.get("X-Request-ID")
    assert rid, "响应缺少 X-Request-ID"
    assert len(rid) >= 16


def test_client_supplied_request_id_is_echoed():
    """客户端可传 X-Request-ID 做端到端串联（nginx/前端已有同名头约定）。"""
    resp = _client().get("/api/health", headers={"X-Request-ID": "trace-abc-123"})
    assert resp.headers.get("X-Request-ID") == "trace-abc-123"
