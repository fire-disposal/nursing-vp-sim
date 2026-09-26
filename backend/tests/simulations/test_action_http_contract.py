"""路由层并发/幂等契约：409 与 replayed 必须真的从 HTTP 冒出来。

服务层的语义在 ``test_action_concurrency.py`` 固定；这里验证 router → schema →
HTTP 这一段（状态码映射与字段落地），避免"服务层对了但接口没接线"。
"""

from tests.simulations.test_api_flow import _client, _create


def _post(sid: int, body: dict):
    return _client.post(f"/api/simulations/sessions/{sid}/actions", json=body)


def test_stale_expected_revision_returns_409():
    sid = _create()["session_id"]
    rev = _post(sid, {"action": {"type": "WAIT"}}).json()["revision"]

    ok = _post(sid, {"action": {"type": "WAIT"}, "expected_revision": rev})
    assert ok.status_code == 200

    stale = _post(sid, {"action": {"type": "WAIT"}, "expected_revision": rev})
    assert stale.status_code == 409
    assert "revision" in stale.json()["detail"]


def test_idempotent_replay_is_reported_over_http():
    sid = _create()["session_id"]
    body = {"action": {"type": "WAIT"}, "idem_key": "http-k1"}

    first = _post(sid, body).json()
    assert first["replayed"] is False
    rev_after_first = first["revision"]

    second = _post(sid, body).json()
    assert second["replayed"] is True
    assert second["messages"] == []
    assert second["revision"] == rev_after_first  # 没有被推进两次


def test_response_carries_replayed_field_by_default():
    sid = _create()["session_id"]
    r = _post(sid, {"action": {"type": "ASSESS", "target": "vitals"}}).json()

    assert r["replayed"] is False
    assert "revision" in r
