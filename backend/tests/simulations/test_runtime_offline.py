"""临床推理模拟的运行期暴露已关闭（docs/18 冻结扩展 + 2026-09-28 收口）。

裁定是「代码保留、冻结扩展」，2026-09-28 只关运行期暴露：``backend/main.py`` 不再 include
``modules.simulations`` 的 router，前端 ``/simulation`` 路由与登录页入口一并下线。
所以任何 ``/api/simulations/**`` 请求必须落 404（既不是 401、也不是 200）；
真被重新挂上（或模块被误删）时本文件必须失败。

模块自身的引擎/服务语义仍由同目录其余测试（test_engine_time / test_visibility / test_consult …）固定；
原先走 HTTP 的 ``test_api_flow.py`` / ``test_action_http_contract.py`` 已随暴露面一起删除。
"""

from fastapi.testclient import TestClient

from main import app

_client = TestClient(app)


def test_simulations_api_paths_are_not_found():
    """未挂载的路径必须 404：401/403 会说明「接口还在、只是没鉴权」，200 说明又挂上了。"""
    cases = [
        ("POST", "/api/simulations/sessions", {"case_id": "mvpb-1"}),
        ("GET", "/api/simulations/sessions/1", None),
        ("POST", "/api/simulations/sessions/1/actions", {"action": {"type": "WAIT"}}),
    ]
    for method, path, body in cases:
        resp = _client.request(method, path, json=body)
        assert resp.status_code == 404, (method, path, resp.status_code, resp.text)


def test_no_route_is_registered_under_the_simulations_prefix():
    mounted = [getattr(r, "path", "") for r in app.routes]
    assert not [p for p in mounted if p.startswith("/api/simulations")]


def test_retained_module_still_exists_and_keeps_its_prefix():
    """冻结不等于删除：模块代码保留，仍可被内部实验直接使用（只是不再挂到 app）。"""
    from modules.simulations.router import router as simulations_router

    assert simulations_router.prefix == "/api/simulations"
