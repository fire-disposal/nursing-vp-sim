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
from modules.scenario_training.runtime.session import append_event, open_session

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


# ── 回放里的锚点面板（docs/21 §五：教师/管理看得到锚点，学生只看得到世界）─────────


def _student_action(turn: int, affordance_id: str) -> dict:
    return {
        "turn": turn,
        "action": {"turn": turn, "affordance_id": affordance_id, "type": "act"},
    }


def test_admin_session_detail_carries_the_anchor_panel(app_client, installed) -> None:
    """逐回合状态 + 阻塞原因 + 被拒提案按回合归位；**大厂已有的键一个都不动**。"""
    client, holder, db = app_client
    pack, revision = installed
    session = open_session(db, user_id=1, revision_id=revision.id, pack=pack)

    append_event(db, session.id, "student_action", _student_action(1, "suction"))
    append_event(
        db,
        session.id,
        "anchor_proposal_rejected",
        {"turn": 1, "anchor_id": "a_control_airway", "proposal": "anchor_satisfied", "actual": "pending"},
    )
    append_event(db, session.id, "dm_turn", {"turn": 1, "narration": "监护仪还在响。"})

    holder["user"] = _FakeUser({"stats_view"})
    detail = client.get(f"/api/scenario/admin/sessions/{session.id}").json()
    anchors = detail["anchors"]
    assert anchors is not None
    assert anchors["count"] == 3
    assert [turn["turn"] for turn in anchors["turns"]] == [0, 1]

    opening = anchors["turns"][0]["states"]
    assert [state["id"] for state in opening] == ["a_see_the_plug", "a_control_airway", "a_reassess_after"]
    # 开场：第一个锚点在推进；第三个被 bag_valve 挡住（原因 = 缺的那一步）
    assert opening[0]["status"] == "active"
    assert opening[0]["stage"] == "airway"
    assert opening[2]["status"] == "blocked"
    assert opening[2]["reason"] == "bag_valve"
    # 催办随回合走：开场与第 1 回合都还没超期（deadline_turns=2）
    assert all(state["nudge"] == "" for state in opening)
    assert anchors["turns"][1]["states"][0]["status"] == "active"

    # 被拒提案归位到它发生的回合（别处没有）
    assert anchors["turns"][0]["rejected"] == []
    assert anchors["turns"][1]["rejected"] == [
        {"turn": 1, "anchor_id": "a_control_airway", "proposal": "anchor_satisfied", "actual": "pending"},
    ]

    # 学生侧的视图里没有锚点：这一块只在管理侧
    assert "anchors" not in detail["view"]
    assert "a_control_airway" not in json.dumps(detail["view"], ensure_ascii=False)


def test_admin_session_detail_anchor_panel_is_null_without_declarations(app_client, pg_session) -> None:
    """不声明 anchors 的病例 → 该块为 `null`（回放界面据此整块不渲染），其他键照旧。"""
    client, holder, _db = app_client
    bare = pack_loader.load_pack_file("night-call-decision")
    _pack_row, revision, _created = pack_loader.install(pg_session, bare)
    session = open_session(pg_session, user_id=7, revision_id=revision.id, pack=bare)
    append_event(pg_session, session.id, "student_action", _student_action(1, "ask_vitals"))

    holder["user"] = _FakeUser({"stats_view"})
    detail = client.get(f"/api/scenario/admin/sessions/{session.id}").json()
    assert detail["anchors"] is None
    assert detail["session"]["id"] == session.id
    assert detail["events"][0]["kind"] == "student_action"


# --------------------------------------------------------------------------- #
# 场景编辑器：读原始内容 / 保存前校验（带字段路径） / 保存必追加新修订
# --------------------------------------------------------------------------- #


def test_editor_source_returns_raw_content_and_revisions(app_client, installed) -> None:
    client, _holder, db = app_client
    pack, revision = installed
    body = client.get(f"/api/scenario/admin/packs/{PACK_KEY}/source")
    assert body.status_code == 200, body.text
    source = body.json()
    # 给的是**原始 content**（编辑器要改的就是它），不是概览投影
    assert source["content"] == revision.content
    assert source["revision_id"] == revision.id
    assert source["revision_no"] == revision.revision_no
    assert source["problems"] == []
    assert [item["id"] for item in source["revisions"]] == [revision.id]

    # 指定旧修订也能读（历史内容照原样给，不假装它还合今天的 schema）
    doc = pack.model_dump(mode="json")
    doc["one_line"] = "第二版文案"
    older = client.post(
        f"/api/scenario/admin/packs/{PACK_KEY}/revisions",
        json={"content": doc, "note": "second"},
    ).json()
    assert older["revision_no"] == revision.revision_no + 1
    assert (
        client.get(f"/api/scenario/admin/packs/{PACK_KEY}/source?revision_id={revision.id}").json()["content"]
        == revision.content
    )
    assert client.get(f"/api/scenario/admin/packs/{PACK_KEY}/source").json()["revision_id"] == older["revision_id"]


def test_editor_validate_names_the_field_path(app_client, installed) -> None:
    """校验失败必须**指名道姓**：形状错给 pydantic 的 loc，引用错给集合[id]。"""
    client, _holder, _db = app_client
    pack, _revision = installed

    # 形状类：pydantic 直接给 loc（不会再往下跑引用校验——形状不过就没有"内容"可查）
    shape = pack.model_dump(mode="json")
    shape["actors"][0]["presence"] = "nowhere"
    result = client.post(f"/api/scenario/admin/packs/{PACK_KEY}/validate", json={"content": shape}).json()
    assert result["ok"] is False
    assert result["content_sha"] is None
    assert "actors.0.presence" in {item["path"] for item in result["problems"]}

    # 引用/词表类：形状合法，`validate_pack` 的中文串被标签化成集合[id]
    reference = pack.model_dump(mode="json")
    reference["assets"][0]["alt"] = ""  # `asset <id>: 缺 alt`
    result = client.post(f"/api/scenario/admin/packs/{PACK_KEY}/validate", json={"content": reference}).json()
    assert result["ok"] is False
    problems = {item["path"]: item["message"] for item in result["problems"]}
    assert f"assets[{reference['assets'][0]['id']}]" in problems
    assert all(message.strip() for message in problems.values())


def test_editor_validate_reports_whether_saving_would_append(app_client, installed) -> None:
    client, _holder, _db = app_client
    pack, revision = installed
    same = client.post(
        f"/api/scenario/admin/packs/{PACK_KEY}/validate", json={"content": pack.model_dump(mode="json")}
    ).json()
    assert same["ok"] is True
    assert same["content_sha"] == revision.content_sha
    assert same["will_append"] is False
    assert same["next_revision_no"] is None

    changed = pack.model_dump(mode="json")
    changed["one_line"] = "改过的文案"
    edited = client.post(f"/api/scenario/admin/packs/{PACK_KEY}/validate", json={"content": changed}).json()
    assert edited["will_append"] is True
    assert edited["next_revision_no"] == revision.revision_no + 1
    assert edited["content_sha"] != revision.content_sha


def test_editor_save_appends_new_revision_and_is_idempotent(app_client, installed) -> None:
    client, _holder, db = app_client
    pack, revision = installed
    db.commit()
    before_content = revision.content

    doc = pack.model_dump(mode="json")
    doc["one_line"] = "夜班，吸不出来，血氧往下掉。"
    saved = client.post(
        f"/api/scenario/admin/packs/{PACK_KEY}/revisions",
        json={"content": doc, "note": "文案修订"},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["created"] is True
    assert saved.json()["revision_no"] == revision.revision_no + 1

    latest = pack_loader.latest_revision(db, PACK_KEY)
    assert latest is not None
    row, new_revision = latest
    assert new_revision.id != revision.id
    assert new_revision.note == "文案修订"
    assert new_revision.content["one_line"] == doc["one_line"]
    assert row.title == doc["title"]  # 展示字段随包内容更新
    # **旧修订原地不动**（永不原地修改）
    assert db.get(StPackRevision, revision.id).content == before_content

    # 内容未变再次保存 → 幂等复用，不产生假修订
    again = client.post(
        f"/api/scenario/admin/packs/{PACK_KEY}/revisions",
        json={"content": doc, "note": "no-op"},
    )
    assert again.json()["created"] is False
    assert again.json()["revision_id"] == new_revision.id
    assert db.execute(select(func.count()).select_from(StPackRevision)).scalar() == 2


def test_editor_save_rejects_invalid_content_and_key_mismatch(app_client, installed) -> None:
    client, _holder, db = app_client
    pack, _revision = installed
    db.commit()

    broken = pack.model_dump(mode="json")
    broken["assets"][0]["alt"] = ""
    rejected = client.post(f"/api/scenario/admin/packs/{PACK_KEY}/revisions", json={"content": broken})
    assert rejected.status_code == 422
    detail = rejected.json()["detail"]
    assert detail["message"] == "包未通过校验"
    assert any(item["message"] for item in detail["problems"])

    other = pack.model_dump(mode="json")
    other["key"] = "some-other-pack"
    mismatched = client.post(f"/api/scenario/admin/packs/{PACK_KEY}/revisions", json={"content": other})
    assert mismatched.status_code == 422
    assert any(item["path"] == "key" for item in mismatched.json()["detail"]["problems"])

    # 两条失败路径都不留半截数据
    assert db.execute(select(func.count()).select_from(StPackRevision)).scalar() == 1


def test_editor_endpoints_require_case_manage(app_client, installed) -> None:
    client, holder, _db = app_client
    pack, _revision = installed
    holder["user"] = _FakeUser({"stats_view"})
    assert client.get(f"/api/scenario/admin/packs/{PACK_KEY}/source").status_code == 403
    assert client.post(f"/api/scenario/admin/packs/{PACK_KEY}/validate", json={"content": {}}).status_code == 403
    assert client.post(f"/api/scenario/admin/packs/{PACK_KEY}/revisions", json={"content": {}}).status_code == 403
    holder["user"] = _FakeUser({"case_manage"})
    assert client.get(f"/api/scenario/admin/packs/{PACK_KEY}/source").status_code == 200
