"""情境训练的 API 级回归：开关语义 + 一回合真实链路（假 LLM，不连外部服务）。

守的是"消费者可见的行为"：关掉开关整段 404；开着一回合能走通，
并且 DM 的违规内容（泄底按钮、未声明资源）会被拦下而不是送给学生。
"""

from __future__ import annotations

import json
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


class _FakeLLM:
    """按脚本返回 DM 回合；记录收到的 prompt 便于断言。"""

    def __init__(self, turn: dict[str, Any]) -> None:
        self.turn = turn
        self.calls: list[list[dict[str, str]]] = []

    async def call(self, messages: list[dict[str, str]], **_: Any) -> str:
        self.calls.append(messages)
        return json.dumps(self.turn, ensure_ascii=False)


def _dm_turn() -> dict[str, Any]:
    return {
        "narration": "你把探头重新扣好，数字没上来。",
        "lines": [{"actor": "patient", "text": "……憋……"}],
        "facts_declared": [{"fact": "吸氧下血氧仍低", "fact_id": "f_low_spo2", "evidence": "88%"}],
        "effects": [{"target": "scene.spo2", "key": "spo2", "op": "decr", "value": 2}],
        "reveals": ["c_low_spo2"],
        "images": [{"asset_id": "a_room", "caption": "病房"}],
        "options": [
            {"label": "听诊双肺", "type": "observe", "affordance_id": "auscultate"},
            {"label": "我自己想想", "type": "ask"},
            {"label": "问问他有没有痰栓堵塞", "type": "act", "affordance_id": "suction"},
            {"label": "其他（自己输入）", "type": "ask"},
        ],
    }


@pytest.fixture
def client(pg_session, monkeypatch):
    from main import app

    def _override_db():
        yield pg_session

    monkeypatch.setattr(scenario_router, "SCENARIO_TRAINING_ENABLED", True)
    pack_loader.reset_cache()
    overrides_before = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = lambda: _FakeUser()
    original = getattr(app.state, "llm_client", None)
    app.state.llm_client = _FakeLLM(_dm_turn())
    app.state.scenario_image_provider = None
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(overrides_before)  # 不破坏其他测试的覆盖
        app.state.llm_client = original
        pack_loader.reset_cache()


@pytest.fixture
def installed_pack(pg_session):
    pack = pack_loader.load_pack_file(PACK_KEY)
    _, revision, _ = pack_loader.install(pg_session, pack)
    return pack, revision


def test_disabled_feature_is_invisible(client, pg_session, monkeypatch) -> None:
    monkeypatch.setattr(scenario_router, "SCENARIO_TRAINING_ENABLED", False)
    assert client.get("/api/scenario/packs").status_code == 404


def test_full_turn_pipeline(client, pg_session, installed_pack) -> None:
    pack, revision = installed_pack
    opened = client.post("/api/scenario/sessions", json={"pack_key": PACK_KEY})
    assert opened.status_code == 200, opened.text
    body = opened.json()
    session_id = body["session_id"]
    view = body["view"]
    assert view["pack"]["revision_id"] == revision.id
    assert [asset["id"] for asset in view["assets"]] == ["a_room"]
    assert view["pack"]["player_role"] == pack.player.role

    # 开场：DM 先立场景（学生还没做任何事）
    assert view["session"]["turn"] == 0
    assert view["messages"], "开场必须有 DM 的叙述/台词"
    assert view["messages"][0]["role"] == "scene"
    assert "你把探头重新扣好" in view["messages"][0]["text"]

    acted = client.post(
        f"/api/scenario/sessions/{session_id}/actions",
        json={"affordance_id": "measure_spo2"},
    )
    assert acted.status_code == 200, acted.text
    after = acted.json()
    view = after["view"]

    # DM 的违规选项被拦下：泄底条目与自带"其他"都不进视图
    labels = [option["label"] for option in view["options"]]
    assert "听诊双肺" in labels
    assert "我自己想想" in labels
    assert all("痰栓" not in label for label in labels)
    assert all("其他" not in label for label in labels)
    assert any(problem.startswith("leaked_fact_term") for problem in after["problems"])
    assert "dm_supplied_free_input" in after["problems"]

    # 图片按资源包投影成可加载 URL；状态改动落在已登记键上
    assert view["images"][0]["asset_id"] == "a_room"
    assert view["images"][0]["url"] == f"/api/scenario/assets/{revision.id}/a_room"
    # 状态改动落在已登记键上：开场与首回合各扣 2（假 DM 的固定效果）；读数经**设备面**投影
    channel = view["devices"][0]["channels"][0]
    assert channel["ref"] == "scene.spo2"
    assert channel["value"] == pack.state_keys["scene.spo2"] - 4
    assert view["session"]["turn"] == 1

    # 资源可被鉴权加载，且只服务本包声明过的资源
    asset = client.get(f"/api/scenario/assets/{revision.id}/a_room")
    assert asset.status_code == 200
    assert asset.headers["content-type"].startswith("image/webp")  # 上传/播种都归一为 WebP
    assert client.get(f"/api/scenario/assets/{revision.id}/nope").status_code == 404

    closed = client.post(f"/api/scenario/sessions/{session_id}/close")
    assert closed.status_code == 200, closed.text
    report = closed.json()["report"]
    assert report["turn"] == 1
    assert set(report["summary"]) == {"strong", "adequate", "missed"}
    assert report["dims"], "经历量化投影必须有值"
    # 结算给**得分率**与逐条权重/得分（每场景自写 rubric）
    assert report["score"]["rate"] is not None
    assert report["score"]["total_weight"] > 0
    assert report["criteria"]
    assert all("weight" in row and "score" in row for row in report["criteria"])


def test_stream_endpoint_emits_blocks_before_view(client, pg_session, installed_pack) -> None:
    """增量渲染：叙述块**先**到，权威视图**后**到；状态等完整回合校验后才落地。"""
    from main import app

    _pack, _revision = installed_pack

    class _StreamingLLM(_FakeLLM):
        async def stream(self, messages, **kwargs):  # type: ignore[override]
            text = json.dumps(self.turn, ensure_ascii=False)
            for index in range(0, len(text), 24):
                yield text[index : index + 24]

    app.state.llm_client = _StreamingLLM(_dm_turn())

    opened = client.post("/api/scenario/sessions", json={"pack_key": PACK_KEY})
    assert opened.status_code == 200, opened.text
    session_id = opened.json()["session_id"]

    events: list[dict] = []
    with client.stream(
        "POST", f"/api/scenario/sessions/{session_id}/actions/stream", json={"affordance_id": "measure_spo2"}
    ) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert response.headers["x-accel-buffering"] == "no"  # 生产 nginx 下必须不缓冲
        for line in response.iter_lines():
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))

    kinds = [event["kind"] for event in events]
    assert "blocks" in kinds, events
    assert kinds[-1] == "view"
    assert kinds.index("blocks") < kinds.index("view")

    narration_blocks = [event["blocks"].get("narration") for event in events if event["kind"] == "blocks"]
    assert any(text and "你把探头重新扣好" in text for text in narration_blocks)

    view = events[-1]["view"]
    assert view["session"]["turn"] == 1  # 开场算第 0 回合；这一次动作是第 1 回合
    assert any(message["role"] == "actor" for message in view["messages"])


def test_session_is_owner_scoped(client, pg_session, installed_pack) -> None:
    opened = client.post("/api/scenario/sessions", json={"pack_key": PACK_KEY})
    session_id = opened.json()["session_id"]
    assert client.get(f"/api/scenario/sessions/{session_id}").status_code == 200

    class _OtherUser(_FakeUser):
        id = 9999

    from main import app

    app.dependency_overrides[get_current_user] = lambda: _OtherUser()
    assert client.get(f"/api/scenario/sessions/{session_id}").status_code == 404
