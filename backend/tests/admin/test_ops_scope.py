"""运维诊断端点的院校边界：全局证据只允许平台级作用域读取。"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from core.security import get_current_user
from core.tenant import TenantScope, get_tenant_scope
from models import User
from modules.admin.ops import router as ops_router


def _client(scope: TenantScope) -> TestClient:
    user = User(username="ops-a", password_hash="x", school_id=scope.school_id)
    user.set_permissions_cache({"api_manage"})

    app = FastAPI()
    app.include_router(ops_router, prefix="/api/admin")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_tenant_scope] = lambda: scope
    return TestClient(app)


def test_tenant_ops_cannot_read_global_dashboard_or_diagnose():
    client = _client(TenantScope(school_id=1, class_ids=None, user_id=1))
    for path in ("/api/admin/ops/dashboard", "/api/admin/ops/diagnose"):
        resp = client.get(path)
        assert resp.status_code == 403, (path, resp.text)
        assert "平台级" in resp.json()["detail"]
