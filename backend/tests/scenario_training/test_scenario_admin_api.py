"""管理侧 API 回归：包上传/资源上传与保存/预览/删除/权限门 + 学生历史 + 数据统计。

守的是"消费者可见的行为"：上传的字节必须能被原样取回、越权必须 403、资源变更必须留痕成新修订。
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from core.database import get_db
from core.security import get_current_user
from models.scenario_training import StAsset, StPack, StPackRevision
from modules.scenario_training import assets as assets_mod
from modules.scenario_training import pack_loader
from modules.scenario_training import router as scenario_router

PACK_KEY = "sputum-ineffective"


class _FakeUser:
    def __init__(self, permissions: set[str] | None = None) -> None:
        self.id = 4242
        self.role_id = 1
        self.token_version = 1
        self.role = type("_Role", (), {"name": "teacher"})()
        self._permissions = permissions or set()

    def has_permission(self, key: str) -> bool:
        return key in self._permissions


async def _no_rate_limit(*_args: object, **_kwargs: object) -> None:
    """限流在 test_scenario_rate_limit 单独覆盖；这里不碰真限流表。"""


class _FakeLLM:
    def __init__(self) -> None:
        self.turn = {
            "narration": "你把探头重新扣好。",
            "lines": [{"actor": "patient", "text": "……"}],
            "effects": [{"target": "scene", "key": "spo2", "op": "set", "value": 90}],
        }

    async def call(self, messages: list[dict[str, str]], **_: object) -> str:
        return json.dumps(self.turn, ensure_ascii=False)


@pytest.fixture
def app_client(pg_session, monkeypatch):
    from main import app

    def _override_db():
        yield pg_session

    monkeypatch.setattr(scenario_router, "SCENARIO_TRAINING_ENABLED", True)
    monkeypatch.setattr(scenario_router, "check_scenario_open_limit", _no_rate_limit)
    monkeypatch.setattr(scenario_router, "check_scenario_action_limit", _no_rate_limit)
    pack_loader.reset_cache()
    # 管理侧夹具默认用户同时持有学生侧键：本文件也走学生端点（开一局再看回放）。
    holder = {"user": _FakeUser({"case_manage", "stats_view", "scenario_training"})}
    overrides_before = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = lambda: holder["user"]
    original = getattr(app.state, "llm_client", None)
    app.state.llm_client = _FakeLLM()
    try:
        yield TestClient(app), holder, pg_session
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(overrides_before)  # 不破坏其他测试的覆盖
        app.state.llm_client = original
        pack_loader.reset_cache()


@pytest.fixture
def installed(pg_session):
    pack = pack_loader.load_pack_file(PACK_KEY)
    _, revision, _ = pack_loader.install(pg_session, pack)
    return pack, revision


def _png() -> bytes:
    return (assets_mod.ASSETS_ROOT / PACK_KEY / "room-panel.png").read_bytes()


def test_student_is_forbidden_on_admin_surface(app_client) -> None:
    client, holder, _db = app_client
    holder["user"] = _FakeUser(set())
    assert client.get("/api/scenario/admin/packs").status_code == 403
    assert client.get("/api/scenario/admin/stats").status_code == 403
    # 学生侧也各有其门（2026-09-27 起判 `scenario_training`）：空权限用户两处都进不去
    assert client.get("/api/scenario/packs").status_code == 403
    holder["user"] = _FakeUser({"scenario_training"})
    assert client.get("/api/scenario/packs").status_code == 200
    assert client.get("/api/scenario/admin/packs").status_code == 403


def test_asset_upload_save_preview_and_delete(app_client, installed) -> None:
    client, _holder, db = app_client
    pack, _revision = installed
    before = pack_loader.latest_revision(db, PACK_KEY)
    assert before is not None
    _pack_row, revision_before = before

    payload = _png()
    uploaded = client.post(
        f"/api/scenario/admin/packs/{PACK_KEY}/assets",
        files={"file": ("scene.png", payload, "image/png")},
        data={"asset_id": "a_scene", "title": "病房环境", "alt": "夜班病房", "suggest_when": "开场时展示"},
    )
    assert uploaded.status_code == 200, uploaded.text
    body = uploaded.json()
    assert body["revision_no"] == revision_before.revision_no + 1
    assert body["asset"]["uploaded"] is True
    assert body["asset"]["file_size"] > 0
    assert body["asset"]["mime_type"] == "image/webp"  # 上传即归一

    # 字节按 pack 修订取回：格式已归一为 WebP，且能正常解码
    served = client.get(f"/api/scenario/assets/{_latest_id(db)}/a_scene")
    assert served.status_code == 200, served.text
    assert served.headers["content-type"].startswith("image/webp")
    assert served.content[:4] == b"RIFF"

    preview = client.get(f"/api/scenario/admin/packs/{PACK_KEY}/assets/a_scene")
    assert preview.status_code == 200
    assert preview.content == served.content

    listing = client.get("/api/scenario/admin/packs").json()
    row = next(item for item in listing if item["key"] == PACK_KEY)
    assert any(asset["id"] == "a_scene" and asset["uploaded"] for asset in row["assets"])
    assert row["revision_no"] == revision_before.revision_no + 1

    dropped = client.delete(f"/api/scenario/admin/packs/{PACK_KEY}/assets/a_scene")
    assert dropped.status_code == 200, dropped.text
    assert dropped.json()["revision_no"] == revision_before.revision_no + 2
    assert db.execute(select(StAsset).where(StAsset.asset_id == "a_scene")).scalar_one_or_none() is None
    # 新修订已不声明它 → 取图 404
    assert client.get(f"/api/scenario/assets/{_latest_id(db)}/a_scene").status_code == 404


def _latest_id(db) -> int:
    latest = pack_loader.latest_revision(db, PACK_KEY)
    assert latest is not None
    return latest[1].id


def test_asset_upload_rejects_non_image(app_client, installed) -> None:
    client, _holder, _db = app_client
    bad = client.post(
        f"/api/scenario/admin/packs/{PACK_KEY}/assets",
        files={"file": ("notes.txt", b"hello", "text/plain")},
        data={"asset_id": "a_bad", "title": "x"},
    )
    assert bad.status_code == 422
    assert "不支持" in json.dumps(bad.json(), ensure_ascii=False)


def test_pack_upload_and_patch_state(app_client, installed) -> None:
    client, _holder, _db = app_client
    pack, _revision = installed
    payload = json.dumps(pack.model_dump(mode="json"), ensure_ascii=False).encode("utf-8")

    uploaded = client.post(
        "/api/scenario/admin/packs",
        files={"file": ("pack.json", payload, "application/json")},
        data={"note": "回归测试"},
    )
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["key"] == PACK_KEY
    assert uploaded.json()["created"] is False  # 内容未变 → 幂等

    patched = client.patch(f"/api/scenario/admin/packs/{PACK_KEY}", json={"state": "reviewed"})
    assert patched.status_code == 200
    assert patched.json()["state"] == "reviewed"

    broken = client.post(
        "/api/scenario/admin/packs",
        files={"file": ("pack.json", b"{not json", "application/json")},
    )
    assert broken.status_code == 422


def test_pack_state_survives_reinstall(app_client, installed) -> None:
    """状态是**管理端拥有的运行期事实**：重装同一包不得把它回退成包 JSON 里的值。"""
    client, _holder, db = app_client
    pack, _revision = installed
    assert client.patch(f"/api/scenario/admin/packs/{PACK_KEY}", json={"state": "reviewed"}).status_code == 200

    payload = json.dumps(pack.model_dump(mode="json"), ensure_ascii=False).encode("utf-8")
    uploaded = client.post(
        "/api/scenario/admin/packs",
        files={"file": ("pack.json", payload, "application/json")},
    )
    assert uploaded.status_code == 200, uploaded.text
    row = next(item for item in client.get("/api/scenario/admin/packs").json() if item["key"] == PACK_KEY)
    assert row["state"] == "reviewed"

    # 同一机制也覆盖"上传图片"这条路（它同样会用包内容走一次 install）
    pack_loader.install(db, pack, note="reinstall")
    assert db.execute(select(StPack).where(StPack.key == PACK_KEY)).scalar_one().state == "reviewed"


def test_pack_upload_rejects_invalid_content(app_client, installed) -> None:
    """形状合法、内容不合法的包：给可读的 4xx（带具体原因），且**不留半截数据**。"""
    client, _holder, db = app_client
    pack, _revision = installed
    db.commit()  # 把基线落地：失败的请求必须整体回滚，既不带走已有行、也不留下新行

    broken = pack.model_dump(mode="json")
    broken["key"] = "broken-pack"
    broken["assets"][0]["alt"] = ""  # 资源无 alt → 加载期校验失败

    uploaded = client.post(
        "/api/scenario/admin/packs",
        files={"file": ("pack.json", json.dumps(broken, ensure_ascii=False).encode("utf-8"), "application/json")},
    )
    assert 400 <= uploaded.status_code < 500, uploaded.text
    detail = uploaded.json()["detail"]
    assert detail["message"] == "包未通过校验"
    assert any("alt" in problem for problem in detail["problems"])

    assert db.execute(select(StPack).where(StPack.key == "broken-pack")).scalar_one_or_none() is None
    assert db.execute(select(func.count()).select_from(StPackRevision)).scalar() == 1
    pack_loader.reset_cache()


def test_legacy_schema_revision_still_readable(pg_session) -> None:
    """历史修订带已删除字段时仍必须可读（升版 + 裁剪加载），否则旧会话直接 500。"""
    from models.scenario_training import StPack, StPackRevision
    from modules.scenario_training.runtime.view import build_view
    from modules.scenario_training.runtime.world import initial_world

    pack = pack_loader.load_pack_file(PACK_KEY)
    legacy = pack.model_dump(mode="json")
    legacy["pack_schema_version"] = 1
    legacy["player"]["attention_per_turn"] = 1  # v1 字段（已删除）
    legacy["affordances"][0]["ineffective"] = True  # v1 字段（已删除）
    legacy["setting"]["cues"][0]["revealed_by"] = ["measure_vitals"]  # v1 字段（已删除）

    pack_row = StPack(key=f"{PACK_KEY}-legacy", title="legacy", state="experimental", one_line="")
    pg_session.add(pack_row)
    pg_session.flush()
    revision = StPackRevision(
        pack_id=pack_row.id,
        revision_no=1,
        pack_schema_version=1,
        content=legacy,
        content_sha="legacy-sha",
        note="legacy",
    )
    pg_session.add(revision)
    pg_session.flush()
    pack_loader.reset_cache()

    loaded = pack_loader.load_revision(pg_session, revision.id)
    assert loaded.key == PACK_KEY
    view = build_view(loaded, initial_world(loaded), session_id=1, status="active", revision_id=revision.id)
    assert view["pack"]["key"] == PACK_KEY
    assert view["situation"]["visible_cues"]


def test_current_schema_content_is_still_strict() -> None:
    """当前版本的包仍然严格校验：作者拼错字段不会被静默吞掉。"""
    pack = pack_loader.load_pack_file(PACK_KEY)
    broken = pack.model_dump(mode="json")
    broken["player"]["attentoin_per_turn"] = 1  # 故意拼错
    with pytest.raises(ValueError):
        type(pack).model_validate(broken)


def test_history_detail_and_stats(app_client, installed) -> None:
    client, holder, _db = app_client
    holder["user"] = _FakeUser({"scenario_training"})  # 学生侧（判 scenario_training）
    opened = client.post("/api/scenario/sessions", json={"pack_key": PACK_KEY})
    assert opened.status_code == 200, opened.text
    session_id = opened.json()["session_id"]
    assert (
        client.post(f"/api/scenario/sessions/{session_id}/actions", json={"affordance_id": "measure_spo2"}).status_code
        == 200
    )
    assert client.post(f"/api/scenario/sessions/{session_id}/close").status_code == 200

    mine = client.get("/api/scenario/sessions").json()
    assert len(mine) == 1
    assert mine[0]["id"] == session_id
    assert mine[0]["status"] == "completed"
    assert mine[0]["summary"] is not None
    assert mine[0]["pack_title"]

    holder["user"] = _FakeUser({"stats_view"})
    listing = client.get(f"/api/scenario/admin/sessions?pack_key={PACK_KEY}").json()
    assert listing["total"] >= 1
    detail = client.get(f"/api/scenario/admin/sessions/{session_id}").json()
    assert detail["session"]["id"] == session_id
    assert detail["event_count"] >= 3
    assert any(event["kind"] == "dm_turn" for event in detail["events"])
    assert isinstance(detail["problems"], list)

    stats = client.get("/api/scenario/admin/stats").json()
    bucket = next(item for item in stats["packs"] if item["pack_key"] == PACK_KEY)
    assert bucket["sessions"] >= 1
    assert sum(bucket["anchors"].values()) >= 1
