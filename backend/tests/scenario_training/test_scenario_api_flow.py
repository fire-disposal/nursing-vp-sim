"""学生侧回合 API：**提交协议**与**学生可见面**的消费者可见边界。

只留四条不变量：
- 一个业务回合只追加**一条** `turn_committed`；同 `request_id` 同输入复用原结果、异输入 409；
- `expected_seq` 过期 → 409 且带回 `current_seq`；
- 失败（循环没交付 / 供应商故障）**不提交、事件零新增**；
- 图片闸门提前发图只拒那一次、不判死回合；
- 学生响应只有世界：工具名/参数/note/拒绝原因一个字都不出现。

确定性结算、时间尺子、澄清、提示、断流查询这些的价值由**真跑一次**兜底，不再逐条钉。
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from core.database import get_db
from core.security import get_current_user
from models.scenario_training import StEvent
from modules.scenario_training import assets as assets_mod
from modules.scenario_training import pack_loader
from modules.scenario_training import router as scenario_router
from tests.scenario_training._stub_llm import StubAgent

PACK_KEY = "sputum-ineffective"


class _FakeUser:
    def __init__(self, permissions: set[str] | None = None, user_id: int = 4242) -> None:
        self.id = user_id
        self.role_id = 1
        self.token_version = 1
        self.role = type("_Role", (), {"name": "student"})()
        self._permissions = permissions or {"scenario_training"}

    def has_permission(self, key: str) -> bool:
        return key in self._permissions


async def _no_rate_limit(*_args: object, **_kwargs: object) -> None:
    return None


@pytest.fixture
def api(pg_session, monkeypatch):
    from main import app

    monkeypatch.setattr(scenario_router, "SCENARIO_TRAINING_ENABLED", True)
    monkeypatch.setattr(scenario_router, "check_scenario_open_limit", _no_rate_limit)
    monkeypatch.setattr(scenario_router, "check_scenario_action_limit", _no_rate_limit)
    pack_loader.reset_cache()
    pack, images = pack_loader.load_case(PACK_KEY)
    case_row, _changed = pack_loader.install(pg_session, pack)
    assets_mod.seed_assets(pg_session, pack, images, overwrite=True)
    holder = {"user": _FakeUser(), "llm": StubAgent()}
    before = dict(app.dependency_overrides)

    def _override_db():
        yield pg_session

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = lambda: holder["user"]
    original = getattr(app.state, "llm_client", None)
    app.state.llm_client = holder["llm"]
    try:
        yield TestClient(app), holder, pg_session, pack, case_row
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(before)
        app.state.llm_client = original
        pack_loader.reset_cache()


def _open(client, holder, case_row) -> tuple[int, int]:
    """开一局：用病例的**当前内容**（会话自带快照，此后改内容不影响这一局）。"""
    holder["user"] = _FakeUser()
    response = client.post("/api/scenario/sessions", json={"pack_key": case_row.key})
    assert response.status_code == 200, response.text
    body = response.json()
    return body["session_id"], body["view"]["session"]["seq"]


def _turn(client, session_id: int, seq: int, **body: Any):
    payload = {"request_id": body.pop("request_id", "r1"), "expected_seq": seq, **body}
    return client.post(f"/api/scenario/sessions/{session_id}/turns", json=payload)


def _events(db, session_id: int) -> list[StEvent]:
    from sqlalchemy import select

    return list(db.execute(select(StEvent).where(StEvent.session_id == session_id).order_by(StEvent.seq)).scalars())


def _committed(db, session_id: int) -> list[StEvent]:
    return [event for event in _events(db, session_id) if event.kind == "turn_committed"]


def test_one_turn_commits_one_event_and_idempotency_holds(api) -> None:
    """一个业务回合**只追加一条** `turn_committed`；同 id 同输入复用原结果；同 id 异输入 409。"""
    client, holder, db, _pack, case_row = api
    session_id, seq = _open(client, holder, case_row)

    first = _turn(client, session_id, seq, request_id="same", kind="action", affordance_id="suction")
    assert first.status_code == 200, first.text
    assert len(_committed(db, session_id)) == 1

    again = _turn(client, session_id, seq, request_id="same", kind="action", affordance_id="suction")
    assert again.status_code == 200, again.text
    assert again.json() == first.json()  # 原结果（连视图都一样）
    assert len(_committed(db, session_id)) == 1  # 幂等：没有第二条

    conflict = _turn(client, session_id, seq, request_id="same", kind="action", affordance_id="call_doctor")
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "request_conflict"
    assert len(_committed(db, session_id)) == 1


def test_stale_expected_seq_is_rejected_with_current_seq(api) -> None:
    """过期基线 → 409 session_conflict 且带 current_seq；事件零新增。"""
    client, holder, db, _pack, case_row = api
    session_id, seq = _open(client, holder, case_row)
    assert _turn(client, session_id, seq, kind="action", affordance_id="suction").status_code == 200

    stale = _turn(client, session_id, seq, request_id="r2", kind="action", affordance_id="measure_spo2")
    assert stale.status_code == 409
    detail = stale.json()["detail"]
    assert detail["code"] == "session_conflict"
    assert detail["current_seq"] == seq + 1
    assert len(_events(db, session_id)) == seq + 1


def test_loop_without_delivery_does_not_commit(api) -> None:
    """步数上限用完仍未交付 → **不提交、事件零新增、世界不变**（不可重试的服务端失败）。"""
    client, holder, db, pack, case_row = api
    session_id, seq = _open(client, holder, case_row)
    llm: StubAgent = holder["llm"]
    llm.rounds = [[("world_set", {"key": "scene.o2_flow", "value": 9})] for _ in range(6)]
    llm.deliver = False

    before = len(_events(db, session_id))
    result = _turn(client, session_id, seq, kind="action", affordance_id="suction")
    assert result.status_code == 500
    assert result.json()["detail"]["code"] == "internal_error"
    assert "problems" not in json.dumps(result.json())
    assert len(_events(db, session_id)) == before

    from modules.scenario_training.runtime import session as session_mod

    world = session_mod.replay(db, session_id, pack)
    assert world.state["scene.o2_flow"] == 3  # 那次工具调用也没留下痕迹


def test_provider_failure_is_retryable_and_leaves_the_world_alone(api, monkeypatch) -> None:
    """供应商故障：可重试；同样不提交、事件零新增。"""
    client, holder, db, _pack, case_row = api
    session_id, seq = _open(client, holder, case_row)
    from core.exceptions import NoProviderAvailable

    async def _boom(*_args: Any, **_kwargs: Any) -> str:
        raise NoProviderAvailable("no key")

    monkeypatch.setattr(holder["llm"], "call_with_tools", _boom)
    before = len(_events(db, session_id))
    result = _turn(client, session_id, seq, kind="action", affordance_id="suction")
    assert result.status_code == 503
    assert result.json()["detail"]["code"] == "provider_unavailable"
    assert len(_events(db, session_id)) == before


def test_image_gate_rejects_one_call_without_killing_the_turn(api) -> None:
    """`reveal_with` 闸门：提前发图 → **只拒这一次**并记账，回合照常交付。"""
    client, holder, db, pack, case_row = api
    gated = pack.model_copy(update={"assets": [pack.assets[0].model_copy(update={"reveal_with": ["c_low_spo2"]})]})
    row, _changed = pack_loader.install(db, gated)
    assert row.version >= 1

    session_id, seq = _open(client, holder, case_row)
    llm: StubAgent = holder["llm"]
    # `auscultate` 只揭示 c_left_absent；c_low_spo2 还没揭示 → 闸门应当拦下这张图
    llm.rounds = [[("present_image", {"asset_id": "a_room"}), ("cue_reveal", {"id": "c_low_spo2"})]]
    llm.narration = "你把耳朵贴上去听了一会儿。"

    result = _turn(client, session_id, seq, kind="action", affordance_id="auscultate")
    assert result.status_code == 200, result.text
    assert result.json()["outcome"] == "performed"  # 不判死回合
    payload = _events(db, session_id)[-1].payload
    assert payload["images"] == []  # 那次调用被拒：图没有发出去
    assert payload["tool_rejections"] == {"image_gated": 1}
    rejected = next(step for step in payload["tools"] if step["tool"] == "present_image")
    assert rejected["ok"] is False
    assert rejected["reason"] == "image_gated"


def test_student_view_never_carries_internal_fields(api) -> None:
    """学生响应只有世界：工具名、参数、note、拒绝原因、判据、隐藏真相一个字都不出现。"""
    client, holder, _db, _pack, case_row = api
    session_id, seq = _open(client, holder, case_row)
    llm: StubAgent = holder["llm"]
    llm.rounds = [
        [
            ("world_set", {"key": "scene.spo2", "value": 91}),
            ("present_image", {"asset_id": "a_room"}),
            ("note_write", {"text": "先别急着吸痰"}),
            ("char_say", {"actor": "patient", "text": "……我喘不上来。", "as_role": None}),
        ]
    ]
    llm.narration = "面罩扣上，机器开始重新报数。"

    body = _turn(client, session_id, seq, kind="action", affordance_id="measure_spo2").json()
    serialized = json.dumps(body, ensure_ascii=False)
    for forbidden in (
        "world_set",
        "present_image",
        "note_write",
        "deliver",
        "先别急着吸痰",
        "tool_rejections",
        "notes",
        "rubric",
        "truth",
    ):
        assert forbidden not in serialized
    assert "……我喘不上来。" in serialized  # 该给学生看的台词照旧
