"""情境训练的**学生侧限流**（正式特性的成本/滥用面）。

守的是"消费者可见的行为"：超限时学生拿到的是**人话 429**（不是 JSON/英文/500），
并且超限会留下一条 `scenario.rate_limited` 审计（运维面按它统计"限流命中次数"，
见 `tests/scenario_training/test_scenario_diagnostics.py` 对取数侧的验证）；
窗口内不超限时结局与限流前完全一致。

限流器用桩（真限流写 `rate_limit_entries`，跨用例共用同一个 user_id 会把窗口打满），
只验证**挂载点、人话文案与留痕内容**这三件消费方能看见的事。
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from core.database import get_db
from core.security import get_current_user
from modules.scenario_training import pack_loader
from modules.scenario_training import router as scenario_router

PACK_KEY = "sputum-ineffective"


class _FakeUser:
    id = 4242
    role_id = 1
    token_version = 1
    role = type("_Role", (), {"name": "student"})()

    def has_permission(self, key: str) -> bool:
        return key == "scenario_training"


class _StubLimiter:
    """只回"放行/拒绝"，并记下 key 与窗口参数（真实实现是 PG 滑窗）。"""

    def __init__(self, allow: bool) -> None:
        self.allow = allow
        self.calls: list[tuple[str, int, int]] = []

    async def is_allowed(self, key: str, max_requests: int, window_seconds: int) -> bool:
        self.calls.append((key, max_requests, window_seconds))
        return self.allow


class _FakeLLM:
    async def call(self, messages: list[dict[str, str]], **_: Any) -> str:
        from tests.scenario_training._stub_llm import stage_aware

        return stage_aware(messages)


@pytest.fixture
def audit_calls(monkeypatch):
    """抓住 `_scenario_limited` 落的审计行（真表写入在测试库里过不了 actor 外键：
    夹具用户并未 commit 到库，故这里只看**内容**）。"""
    from core import audit

    calls: list[dict[str, Any]] = []

    def _record_detached(request=None, **kwargs: Any) -> None:
        calls.append(kwargs)

    monkeypatch.setattr(audit, "record_detached", _record_detached)
    return calls


@pytest.fixture
def app_client(pg_session, monkeypatch, audit_calls):
    from main import app

    def _override_db():
        yield pg_session

    monkeypatch.setattr(scenario_router, "SCENARIO_TRAINING_ENABLED", True)
    pack_loader.reset_cache()
    limiter = _StubLimiter(allow=True)
    overrides_before = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = lambda: _FakeUser()
    original_llm = getattr(app.state, "llm_client", None)
    original_limiter = getattr(app.state, "rate_limiter", None)
    app.state.llm_client = _FakeLLM()
    app.state.scenario_image_provider = None
    app.state.rate_limiter = limiter
    try:
        yield TestClient(app), limiter
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(overrides_before)
        app.state.llm_client = original_llm
        if original_limiter is not None:
            app.state.rate_limiter = original_limiter
        pack_loader.reset_cache()


@pytest.fixture
def installed(pg_session):
    pack = pack_loader.load_pack_file(PACK_KEY)
    pack_loader.install(pg_session, pack)
    return pack


def test_action_limit_hits_are_human_and_audited(app_client, installed, audit_calls) -> None:
    client, limiter = app_client
    opened = client.post("/api/scenario/sessions", json={"pack_key": PACK_KEY})
    assert opened.status_code == 200, opened.text
    session_id = opened.json()["session_id"]

    limiter.allow = False
    blocked = client.post(
        f"/api/scenario/sessions/{session_id}/turns",
        json={"request_id": "rl-1", "expected_seq": 1, "kind": "action", "affordance_id": "measure_spo2"},
    )

    assert blocked.status_code == 429
    detail = blocked.json()["detail"]
    assert "操作过于频繁" in detail  # 人话，不是 JSON/英文
    assert detail.isascii() is False

    # 流式端点走同一个动作限流
    stream_blocked = client.post(
        f"/api/scenario/sessions/{session_id}/turns/stream",
        json={"request_id": "rl-1", "expected_seq": 1, "kind": "action", "affordance_id": "measure_spo2"},
    )
    assert stream_blocked.status_code == 429

    assert [call["action"] for call in audit_calls] == ["scenario.rate_limited"] * 2
    assert audit_calls[-1]["outcome"] == "denied"
    assert audit_calls[-1]["target_id"] == "action"
    assert audit_calls[-1]["payload"] == {"scope": "action", "limit": 30, "window_seconds": 300}

    key, max_requests, window_seconds = limiter.calls[-1]
    assert key == "scenario_action:4242"
    assert (max_requests, window_seconds) == (30, 300)


def test_open_limit_hits_are_human_and_audited(app_client, installed, audit_calls) -> None:
    client, limiter = app_client

    limiter.allow = False
    blocked = client.post("/api/scenario/sessions", json={"pack_key": PACK_KEY})
    assert blocked.status_code == 429
    assert "今天开启的情境次数已达上限" in blocked.json()["detail"]

    assert [call["action"] for call in audit_calls] == ["scenario.rate_limited"]
    assert audit_calls[0]["target_id"] == "open"
    assert audit_calls[0]["payload"] == {"scope": "open", "limit": 20, "window_seconds": 86400}

    key, max_requests, window_seconds = limiter.calls[-1]
    assert key == "scenario_open:4242"
    assert (max_requests, window_seconds) == (20, 86400)


def test_within_limit_keeps_normal_flow(app_client, installed, audit_calls) -> None:
    """窗口内不超限：开局与动作照常（限流只压尖峰，不改语义），也不留限流审计。"""
    client, limiter = app_client

    opened = client.post("/api/scenario/sessions", json={"pack_key": PACK_KEY})
    assert opened.status_code == 200, opened.text
    acted = client.post(
        f"/api/scenario/sessions/{opened.json()['session_id']}/turns",
        json={"request_id": "rl-1", "expected_seq": 1, "kind": "action", "affordance_id": "measure_spo2"},
    )
    assert acted.status_code == 200, acted.text
    assert audit_calls == []
    assert [call[0] for call in limiter.calls] == ["scenario_open:4242", "scenario_action:4242"]
