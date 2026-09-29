"""管理侧 API 回归：包上传/资源上传与保存/预览/删除/权限门 + 学生历史 + 数据统计 + 内容版本不变量。

守的是"消费者可见的行为"：上传的字节必须能被原样取回、越权必须 403、内容改了 version 才 +1、
**开局时的内容快照**不受病例后续修改影响（改内容后再回放旧局，结果一个字都不变）。
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from core.database import get_db
from core.security import get_current_user
from models.scenario_training import StAsset, StPack, StSession
from modules.scenario_training import assets as assets_mod
from modules.scenario_training import pack_loader
from modules.scenario_training import router as scenario_router
from modules.scenario_training.runtime.session import append_event

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
    """两阶段各自的合法输出：解析阶段给 `IntentResolution`，演出阶段给 `SceneDelivery`。

    演出**没有写权限**——所以这里也造不出世界改动（这正是新机制的边界）。
    """

    def __init__(self) -> None:
        self.intent = {
            "kind": "action",
            "affordance_id": "measure_spo2",
            "utterance": "",
            "clarification": "",
            "selection": [],
            "social_updates": [],
        }
        self.delivery = {
            "messages": [
                {"speaker": None, "text": "你把手套戴好，床边的机器还在响。"},
                {"speaker": "patient", "text": "……"},
            ],
            "hints": [],
            "assets": [],
            "highlights": [],
        }

    async def call(self, messages: list[dict[str, str]], **_: object) -> str:
        system = messages[0]["content"] if messages else ""
        return json.dumps(self.intent if "意图解析器" in system else self.delivery, ensure_ascii=False)


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
    row, _changed = pack_loader.install(pg_session, pack)
    return pack, row


def _pack_version(db, key: str = PACK_KEY) -> int:
    return int(db.execute(select(StPack.version).where(StPack.key == key)).scalar_one())


def _insert_session(db, pack, *, user_id: int = 1, meta: dict | None = None):
    """直接建一行会话 + 开场事件（绕开真实 LLM 的开场演出，专测读路径）。

    会话带**内容快照**：此后病例内容怎么改都不影响这一局。
    """
    row = StSession(
        user_id=user_id,
        pack_key=pack.key,
        pack_version=1,
        pack_content=pack.model_dump(mode="json"),
        status="active",
        meta=dict(meta or {}),
    )
    db.add(row)
    db.flush()
    append_event(db, row.id, "session_opened", {"pack_key": pack.key, "pack_version": 1})
    return row


def _turn_payload(turn: int, affordance_id: str, *, outcome: str = "performed") -> dict:
    return {
        "schema": 1,
        "request_id": f"r{turn}",
        "turn": turn,
        "input": {"kind": "action", "affordance_id": affordance_id, "selection": [], "text": ""},
        "intent": {"kind": "action", "affordance_id": affordance_id, "utterance": "", "clarification": ""},
        "outcome": outcome,
        "block_reason": "",
        "actions": [{"turn": turn, "affordance_id": affordance_id, "type": "act"}],
        "effects": [],
        "reveals": [],
        "reactions": [],
        "social": [],
        "messages": [{"speaker": None, "text": "监护仪还在响。", "kind": "narration", "origin": "dm"}],
        "notice_text": "",
        "images": [],
        "noticed": [],
        "focus": [],
        "facts": [],
        "models": {"parse": 0, "delivery": 1},
        "problems": [],
    }


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
    pack, _row = installed
    version_before = _pack_version(db)

    payload = _png()
    uploaded = client.post(
        f"/api/scenario/admin/packs/{PACK_KEY}/assets",
        files={"file": ("scene.png", payload, "image/png")},
        data={"asset_id": "a_scene", "title": "病房环境", "alt": "夜班病房"},
    )
    assert uploaded.status_code == 200, uploaded.text
    body = uploaded.json()
    assert body["key"] == PACK_KEY
    assert body["asset"]["uploaded"] is True
    assert body["asset"]["file_size"] > 0
    assert body["asset"]["mime_type"] == "image/webp"  # 上传即归一
    assert _pack_version(db) == version_before + 1  # 声明写进了当前内容 → version +1

    # 字节按 pack key 取回：格式已归一为 WebP，且能正常解码
    served = client.get(f"/api/scenario/assets/{PACK_KEY}/a_scene")
    assert served.status_code == 200, served.text
    assert served.headers["content-type"].startswith("image/webp")
    assert served.content[:4] == b"RIFF"

    preview = client.get(f"/api/scenario/admin/packs/{PACK_KEY}/assets/a_scene")
    assert preview.status_code == 200
    assert preview.content == served.content

    listing = client.get("/api/scenario/admin/packs").json()
    row = next(item for item in listing if item["key"] == PACK_KEY)
    assert any(asset["id"] == "a_scene" and asset["uploaded"] for asset in row["assets"])
    assert row["version"] == version_before + 1

    dropped = client.delete(f"/api/scenario/admin/packs/{PACK_KEY}/assets/a_scene")
    assert dropped.status_code == 200, dropped.text
    assert dropped.json()["version"] == version_before + 2
    assert db.execute(select(StAsset).where(StAsset.asset_id == "a_scene")).scalar_one_or_none() is None
    # 当前内容已不声明它 → 取图 404
    assert client.get(f"/api/scenario/assets/{PACK_KEY}/a_scene").status_code == 404
    listing_after = next(item for item in client.get("/api/scenario/admin/packs").json() if item["key"] == PACK_KEY)
    assert all(asset["id"] != "a_scene" for asset in listing_after["assets"])


def test_asset_upload_rejects_non_image(app_client, installed) -> None:
    client, _holder, _db = app_client
    bad = client.post(
        f"/api/scenario/admin/packs/{PACK_KEY}/assets",
        files={"file": ("notes.txt", b"hello", "text/plain")},
        data={"asset_id": "a_bad", "title": "x"},
    )
    assert bad.status_code == 422
    assert "不支持" in json.dumps(bad.json(), ensure_ascii=False)


def test_pack_upload_is_idempotent_and_title_comes_from_content(app_client, installed) -> None:
    """上传同一份内容 → 幂等不涨版本；`title` / `one_line` **只来自内容**（没有单独的改名接口）。"""
    client, _holder, db = app_client
    pack, _row = installed
    version = _pack_version(db)
    payload = json.dumps(pack.model_dump(mode="json"), ensure_ascii=False).encode("utf-8")

    uploaded = client.post(
        "/api/scenario/admin/packs",
        files={"file": ("pack.json", payload, "application/json")},
    )
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["key"] == PACK_KEY
    assert uploaded.json()["created"] is False  # 内容未变 → 幂等
    assert uploaded.json()["version"] == version

    # 展示字段来自内容：列表与内容端点给出同一份
    row = next(item for item in client.get("/api/scenario/admin/packs").json() if item["key"] == PACK_KEY)
    assert row["title"] == pack.title
    assert row["one_line"] == pack.one_line
    assert client.get(f"/api/scenario/admin/packs/{PACK_KEY}/content").json()["title"] == pack.title

    # 改名只能通过保存内容（内容本来就是唯一真源）→ version +1，列表立刻反映
    renamed = pack.model_dump(mode="json")
    renamed["title"] = "改过的标题"
    saved = client.post(f"/api/scenario/admin/packs/{PACK_KEY}/content", json={"content": renamed})
    assert saved.status_code == 200, saved.text
    assert saved.json()["title"] == "改过的标题"
    assert saved.json()["version"] == version + 1
    row = next(item for item in client.get("/api/scenario/admin/packs").json() if item["key"] == PACK_KEY)
    assert row["title"] == "改过的标题"
    assert row["version"] == version + 1

    broken = client.post(
        "/api/scenario/admin/packs",
        files={"file": ("pack.json", b"{not json", "application/json")},
    )
    assert broken.status_code == 422


def test_pack_upload_rejects_invalid_content(app_client, installed) -> None:
    """形状合法、内容不合法的包：给可读的 4xx（带具体原因），且**不留半截数据**。"""
    client, _holder, db = app_client
    pack, _row = installed
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
    assert db.execute(select(func.count()).select_from(StPack)).scalar() == 1
    pack_loader.reset_cache()


def test_current_schema_content_is_still_strict() -> None:
    """当前版本的包仍然严格校验：作者拼错字段不会被静默吞掉。"""
    pack = pack_loader.load_pack_file(PACK_KEY)
    broken = pack.model_dump(mode="json")
    broken["player"]["attentoion_per_turn"] = 1  # 故意拼错
    with pytest.raises(ValueError):
        type(pack).model_validate(broken)


def test_history_detail_and_stats(app_client, installed) -> None:
    client, holder, _db = app_client
    holder["user"] = _FakeUser({"scenario_training"})  # 学生侧（判 scenario_training）
    opened = client.post("/api/scenario/sessions", json={"pack_key": PACK_KEY})
    assert opened.status_code == 200, opened.text
    session_id = opened.json()["session_id"]
    seq = opened.json()["view"]["session"]["seq"]
    turned = client.post(
        f"/api/scenario/sessions/{session_id}/turns",
        json={"request_id": "t1", "expected_seq": seq, "kind": "action", "affordance_id": "suction"},
    )
    assert turned.status_code == 200, turned.text
    assert turned.json()["outcome"] == "performed"
    seq = turned.json()["seq"]
    closed = client.post(f"/api/scenario/sessions/{session_id}/close", json={"request_id": "c1", "expected_seq": seq})
    assert closed.status_code == 200, closed.text

    mine = client.get("/api/scenario/sessions").json()
    assert len(mine) == 1, mine
    assert mine[0]["id"] == session_id
    assert mine[0]["status"] == "completed"
    assert mine[0]["summary"] is not None
    assert mine[0]["pack_title"]
    assert mine[0]["pack_version"] >= 1

    holder["user"] = _FakeUser({"stats_view"})
    listing = client.get(f"/api/scenario/admin/sessions?pack_key={PACK_KEY}").json()
    assert listing["total"] >= 1, listing
    detail = client.get(f"/api/scenario/admin/sessions/{session_id}").json()
    assert detail["session"]["id"] == session_id
    assert detail["event_count"] >= 3, detail["events"]
    assert any(event["kind"] == "turn_committed" for event in detail["events"])
    assert isinstance(detail["problems"], list)
    # 逐回合来源回放：解析 / 结算 / 交付都在（教师看得到，学生看不到）
    assert detail["turns"]
    assert detail["turns"][0]["seq"] >= 1
    assert detail["turns"][0]["outcome"] == "performed"
    assert detail["turns"][0]["resolved"]["turn"] == 2  # suction 的 time_cost=2
    assert detail["turns"][0]["resolved"]["time_cost"] == 2
    assert "problems" not in json.dumps(detail["view"], ensure_ascii=False)
    assert '"focus"' not in json.dumps(detail["view"], ensure_ascii=False)

    # 关注点面板取代锚点：逐回合快照 + 幻灯计数（管理侧才有的聚合）
    assert len(detail["focus"]) >= 1
    assert all("id" in state for state in detail["focus"][-1]["states"])

    stats = client.get("/api/scenario/admin/stats").json()
    bucket = next(item for item in stats["packs"] if item["pack_key"] == PACK_KEY)
    assert bucket["sessions"] >= 1, stats
    assert bucket["focus_address_ratio"] is not None  # 关注点聚合来自 session_closed 载荷


# ── 回放：解析/结算/交付来源 + 教学关注点（取代旧的锚点面板）────────────────────


def test_admin_session_detail_replays_settlement_and_focus(app_client, installed) -> None:
    """逐回合回放来自事件载荷（不是模型思考过程）；学生视图里没有关注点与内部字段。"""
    client, holder, db = app_client
    pack, _row = installed
    session = _insert_session(db, pack)
    append_event(db, session.id, "turn_committed", _turn_payload(1, "auscultate"))

    holder["user"] = _FakeUser({"stats_view"})
    detail = client.get(f"/api/scenario/admin/sessions/{session.id}").json()
    assert [turn["turn"] for turn in detail["turns"]] == [1]
    replayed = detail["turns"][0]
    assert replayed["input"]["affordance_id"] == "auscultate"
    assert replayed["outcome"] == "performed"
    assert replayed["models"]["delivery"] == 1
    assert detail["focus"]
    assert detail["focus"][-1]["turn"] == 1
    # 关注点只给教师/作者看：学生视图里一个字都没有
    serialized = json.dumps(detail["view"], ensure_ascii=False)
    assert "teaching_focus" not in serialized
    assert pack.teaching_focus[0].id not in serialized


def test_admin_stats_counts_focus_from_events(app_client, installed) -> None:
    """关注点聚合来自 `session_closed` 载荷；没有结算过就没有计数（不编数）。"""
    client, holder, db = app_client
    pack, _row = installed
    session = _insert_session(db, pack)
    append_event(db, session.id, "turn_committed", _turn_payload(1, "suction"))
    holder["user"] = _FakeUser({"stats_view"})
    before = client.get("/api/scenario/admin/stats").json()
    bucket = next(item for item in before["packs"] if item["pack_key"] == PACK_KEY)
    assert bucket["focus_address_ratio"] is None  # 还没结算过

    from core.unit_of_work import unit_of_work

    with unit_of_work(db):
        append_event(
            db,
            session.id,
            "session_closed",
            {"request_id": "c1", "focus_relevant": 3, "focus_addressed": 1, "summary": {}, "turn": 1},
        )
    after = client.get("/api/scenario/admin/stats").json()
    bucket = next(item for item in after["packs"] if item["pack_key"] == PACK_KEY)
    assert bucket["focus_address_ratio"] == pytest.approx(1 / 3, abs=1e-4)


# --------------------------------------------------------------------------- #
# 场景编辑器：读/存当前内容（带字段路径的校验） + 版本不变量
# --------------------------------------------------------------------------- #


def test_editor_content_reads_the_current_content(app_client, installed) -> None:
    client, _holder, _db = app_client
    pack, row = installed
    body = client.get(f"/api/scenario/admin/packs/{PACK_KEY}/content")
    assert body.status_code == 200, body.text
    current = body.json()
    # 给的是**原始 content**（编辑器要改的就是它），不是概览投影
    assert current["content"] == row.content
    assert current["version"] == row.version
    assert current["problems"] == []
    assert current["published"] is True


def test_editor_save_is_idempotent_for_identical_content(app_client, installed) -> None:
    """**同内容重复保存不涨 version**（否则"存了但没变"会刷版本号）。"""
    client, _holder, db = app_client
    pack, _row = installed
    version = _pack_version(db)

    same = client.post(f"/api/scenario/admin/packs/{PACK_KEY}/content", json={"content": pack.model_dump(mode="json")})
    assert same.status_code == 200, same.text
    assert same.json()["changed"] is False
    assert same.json()["version"] == version
    assert _pack_version(db) == version

    again = client.post(f"/api/scenario/admin/packs/{PACK_KEY}/content", json={"content": pack.model_dump(mode="json")})
    assert again.json()["changed"] is False
    assert _pack_version(db) == version


def test_editor_save_bumps_version_and_replaces_content(app_client, installed) -> None:
    """**改内容则 version +1**，且库里只保留这一份（没有历史多行）。"""
    client, _holder, db = app_client
    pack, _row = installed
    version = _pack_version(db)

    doc = pack.model_dump(mode="json")
    doc["one_line"] = "夜班，吸不出来，血氧往下掉。"
    saved = client.post(f"/api/scenario/admin/packs/{PACK_KEY}/content", json={"content": doc})
    assert saved.status_code == 200, saved.text
    assert saved.json()["changed"] is True
    assert saved.json()["version"] == version + 1
    assert saved.json()["content"]["one_line"] == doc["one_line"]
    assert saved.json()["title"] == doc["title"]  # 展示字段随内容更新

    stored = db.execute(select(StPack).where(StPack.key == PACK_KEY)).scalar_one()
    assert stored.content["one_line"] == doc["one_line"]
    assert stored.version == version + 1
    assert db.execute(select(func.count()).select_from(StPack)).scalar() == 1

    # 读回来是新内容（编辑器下一轮拿到的是刚存的那份）
    assert client.get(f"/api/scenario/admin/packs/{PACK_KEY}/content").json()["content"] == stored.content


def test_editor_save_rejects_invalid_content_and_key_mismatch(app_client, installed) -> None:
    client, _holder, db = app_client
    pack, _row = installed
    version = _pack_version(db)
    db.commit()

    broken = pack.model_dump(mode="json")
    broken["assets"][0]["alt"] = ""
    rejected = client.post(f"/api/scenario/admin/packs/{PACK_KEY}/content", json={"content": broken})
    assert rejected.status_code == 422
    detail = rejected.json()["detail"]
    assert detail["message"] == "包未通过校验"
    assert any(item["message"] for item in detail["problems"])

    other = pack.model_dump(mode="json")
    other["key"] = "some-other-pack"
    mismatched = client.post(f"/api/scenario/admin/packs/{PACK_KEY}/content", json={"content": other})
    assert mismatched.status_code == 422
    assert any(item["path"] == "key" for item in mismatched.json()["detail"]["problems"])

    # 两条失败路径都不留半截数据、也不涨版本
    assert _pack_version(db) == version
    assert db.execute(select(StPack).where(StPack.key == "some-other-pack")).scalar_one_or_none() is None


def test_editor_validate_names_the_field_path(app_client, installed) -> None:
    """校验失败必须**指名道姓**：形状错给 pydantic 的 loc，引用错给集合[id]。"""
    client, _holder, _db = app_client
    pack, _row = installed

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


def test_editor_validate_reports_whether_saving_would_change_the_version(app_client, installed) -> None:
    client, _holder, _db = app_client
    pack, row = installed
    same = client.post(
        f"/api/scenario/admin/packs/{PACK_KEY}/validate", json={"content": pack.model_dump(mode="json")}
    ).json()
    assert same["ok"] is True
    assert same["latest_sha"] == pack_loader.content_sha(row.content)
    assert same["will_change"] is False
    assert same["version"] == row.version

    changed = pack.model_dump(mode="json")
    changed["one_line"] = "改过的文案"
    edited = client.post(f"/api/scenario/admin/packs/{PACK_KEY}/validate", json={"content": changed}).json()
    assert edited["will_change"] is True
    assert edited["content_sha"] != same["latest_sha"]
    assert edited["version"] == row.version  # 还没存


def test_editor_endpoints_require_case_manage(app_client, installed) -> None:
    client, holder, _db = app_client
    holder["user"] = _FakeUser({"stats_view"})
    assert client.get(f"/api/scenario/admin/packs/{PACK_KEY}/content").status_code == 403
    assert client.post(f"/api/scenario/admin/packs/{PACK_KEY}/validate", json={"content": {}}).status_code == 403
    assert client.post(f"/api/scenario/admin/packs/{PACK_KEY}/content", json={"content": {}}).status_code == 403
    holder["user"] = _FakeUser({"case_manage"})
    assert client.get(f"/api/scenario/admin/packs/{PACK_KEY}/content").status_code == 200


# --------------------------------------------------------------------------- #
# 病例管理：新建 / 复制 / 上架 / 下架 / 删除（作者在系统侧完成，不依赖仓库文件）
# --------------------------------------------------------------------------- #


def _student(client, holder) -> None:
    holder["user"] = _FakeUser({"scenario_training"})


def _admin(client, holder) -> None:
    holder["user"] = _FakeUser({"case_manage", "stats_view", "scenario_training"})


def _solid_png(colour: tuple[int, int, int]) -> bytes:
    """造一张真实的、**与另一张不同**的图片（规范器会重编码，同图加尾巴会归一成同一份字节）。"""
    from io import BytesIO

    from PIL import Image

    buffer = BytesIO()
    Image.new("RGB", (8, 8), colour).save(buffer, format="PNG")
    return buffer.getvalue()


def _open_pack_session(client, key: str) -> tuple[int, int]:
    opened = client.post("/api/scenario/sessions", json={"pack_key": key})
    assert opened.status_code == 200, opened.text
    return opened.json()["session_id"], opened.json()["view"]["session"]["seq"]


def _case(client, key: str) -> dict:
    for item in client.get("/api/scenario/admin/packs").json():
        if item["key"] == key:
            return item
    raise AssertionError(f"{key} 不在列表里")


def test_blank_pack_is_runnable_skeleton_and_starts_unpublished(app_client) -> None:
    """新建空白 = **最小可运行骨架** + 草稿：学生看不到、开不了；作者试跑能开。"""
    client, holder, _db = app_client
    _admin(client, holder)
    created = client.post("/api/scenario/admin/packs/blank", json={"key": "blank-case", "title": "空白病例"})
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["version"] == 1
    assert body["created"] is True
    item = _case(client, "blank-case")
    assert item["published"] is False
    assert item["published_at"] is None
    assert item["version"] == 1
    assert item["overview"]["actors"]
    assert item["overview"]["affordances"] == 1

    # 未上架：学生列表里没有它，也开不了新局
    _student(client, holder)
    assert "blank-case" not in [row["key"] for row in client.get("/api/scenario/packs").json()]
    blocked = client.post("/api/scenario/sessions", json={"pack_key": "blank-case"})
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "pack_unpublished"

    # 作者试跑不受上架状态限制（用当前内容，会话显式标记 trial）
    _admin(client, holder)
    trial = client.post("/api/scenario/sessions", json={"pack_key": "blank-case", "trial": True})
    assert trial.status_code == 200, trial.text
    assert trial.json()["view"]["session"]["trial"] is True
    assert trial.json()["view"]["pack"]["version"] == 1

    assert client.post("/api/scenario/admin/packs/blank", json={"key": "blank-case", "title": "x"}).status_code == 409


def test_publish_unpublish_gate_students_but_not_running_sessions(app_client, installed) -> None:
    """上架后学生可见可开；下架后学生开不了新局、**已进行的会话照常继续**。"""
    client, holder, _db = app_client
    pack, _row = installed
    _student(client, holder)
    session_id, seq = _open_pack_session(client, pack.key)
    assert session_id

    _admin(client, holder)
    published = client.post(f"/api/scenario/admin/packs/{pack.key}/publish")
    assert published.status_code == 200, published.text
    assert published.json()["published"] is True
    assert published.json()["published_at"] is not None
    _student(client, holder)
    assert pack.key in [row["key"] for row in client.get("/api/scenario/packs").json()]
    assert client.post("/api/scenario/sessions", json={"pack_key": pack.key}).status_code == 200

    _admin(client, holder)
    assert client.post(f"/api/scenario/admin/packs/{pack.key}/unpublish").json()["published"] is False
    _student(client, holder)
    assert pack.key not in [row["key"] for row in client.get("/api/scenario/packs").json()]
    assert client.post("/api/scenario/sessions", json={"pack_key": pack.key}).status_code == 409
    # 下架不打断进行中的会话：老会话照常可读、可继续
    assert client.get(f"/api/scenario/sessions/{session_id}").status_code == 200
    turned = client.post(
        f"/api/scenario/sessions/{session_id}/turns",
        json={"request_id": "after-unpublish", "expected_seq": seq, "kind": "action", "affordance_id": "auscultate"},
    )
    assert turned.status_code == 200, turned.text
    assert turned.json()["outcome"] == "performed"


def test_publish_refuses_incomplete_content_with_field_paths(app_client) -> None:
    """上架前必须过加载期同一套校验：缺「你扮演谁 / 在哪儿 / 人物 / 动作」时按字段路径报错。"""
    client, holder, db = app_client
    _admin(client, holder)
    client.post("/api/scenario/admin/packs/blank", json={"key": "incomplete", "title": "不完整"})
    row = db.execute(select(StPack).where(StPack.key == "incomplete")).scalar_one()
    content = dict(row.content)
    content["player"] = {"role": ""}
    content["setting"] = {"place": ""}
    content["actors"] = []
    content["affordances"] = []
    row.content = content
    db.flush()

    refused = client.post("/api/scenario/admin/packs/incomplete/publish")
    assert refused.status_code == 422, refused.text
    paths = {item["path"] for item in refused.json()["detail"]["problems"]}
    assert {"player.role", "setting.place", "actors", "affordances"} <= paths
    assert _case(client, "incomplete")["published"] is False


def test_duplicate_copies_current_content_into_a_new_draft(app_client, installed) -> None:
    """复制 = 源病例**当前内容**，指向新 key，从草稿开始（做变式）。"""
    client, holder, _db = app_client
    pack, _row = installed
    _admin(client, holder)
    copied = client.post(
        f"/api/scenario/admin/packs/{pack.key}/duplicate", json={"key": "variant-case", "title": "变式"}
    )
    assert copied.status_code == 200, copied.text
    assert copied.json()["version"] == 1
    item = _case(client, "variant-case")
    assert item["published"] is False
    source = client.get(f"/api/scenario/admin/packs/{pack.key}/content").json()["content"]
    clone = client.get("/api/scenario/admin/packs/variant-case/content").json()["content"]
    assert clone["key"] == "variant-case"
    assert [a["id"] for a in clone["affordances"]] == [a["id"] for a in source["affordances"]]
    assert clone["actors"] == source["actors"]
    # 占用 key
    assert (
        client.post(
            f"/api/scenario/admin/packs/{pack.key}/duplicate", json={"key": "variant-case", "title": "x"}
        ).status_code
        == 409
    )


def test_delete_requires_confirm_and_refuses_cases_with_sessions(app_client, installed) -> None:
    """删除：缺 confirm → 400；有会话 → 409 并给出局数；无会话 → 真删（资源一并清理）。"""
    client, holder, db = app_client
    pack, _row = installed
    _admin(client, holder)
    assert client.delete(f"/api/scenario/admin/packs/{pack.key}").status_code == 400

    _student(client, holder)
    _open_pack_session(client, pack.key)
    _admin(client, holder)
    refused = client.delete(f"/api/scenario/admin/packs/{pack.key}?confirm=true")
    assert refused.status_code == 409, refused.text
    detail = refused.json()["detail"]
    assert detail["code"] == "pack_has_sessions"
    assert detail["sessions"] == 1
    assert "可下架但不可删除" in detail["message"]
    assert db.execute(select(StPack).where(StPack.key == pack.key)).scalar_one_or_none() is not None

    # 没有会话的病例可以删干净
    client.post("/api/scenario/admin/packs/blank", json={"key": "doomed", "title": "要删的"})
    deleted = client.delete("/api/scenario/admin/packs/doomed?confirm=true")
    assert deleted.status_code == 200, deleted.text
    assert deleted.json() == {"key": "doomed", "deleted_assets": 0}
    assert all(item["key"] != "doomed" for item in client.get("/api/scenario/admin/packs").json())
    assert db.execute(select(StPack).where(StPack.key == "doomed")).scalar_one_or_none() is None


def test_asset_replace_keeps_asset_id_and_rewrites_current_content(app_client, installed) -> None:
    """替换图片：asset_id 不变（编辑器 JSON 不用改），字节换掉，当前内容 version +1。"""
    client, holder, db = app_client
    pack, _row = installed
    _admin(client, holder)
    first = client.post(
        f"/api/scenario/admin/packs/{pack.key}/assets",
        data={"asset_id": "swap_me", "title": "换我", "alt": "换我"},
        files={"file": ("a.png", _solid_png((200, 30, 30)), "image/png")},
    )
    assert first.status_code == 200, first.text
    version_after_upload = _pack_version(db)
    before_row = db.execute(
        select(StAsset).where(StAsset.pack_key == pack.key, StAsset.asset_id == "swap_me")
    ).scalar_one()
    before_bytes, before_size = bytes(before_row.content), before_row.file_size

    replaced = client.post(
        f"/api/scenario/admin/packs/{pack.key}/assets/swap_me",
        data={"alt": "换过了"},
        files={"file": ("b.png", _solid_png((30, 30, 200)), "image/png")},
    )
    assert replaced.status_code == 200, replaced.text
    assert replaced.json()["asset"]["id"] == "swap_me"
    after = db.execute(select(StAsset).where(StAsset.pack_key == pack.key, StAsset.asset_id == "swap_me")).scalar_one()
    assert after.id == before_row.id  # 同一个 asset_id（编辑器里的 JSON 引用不用改）
    assert bytes(after.content) != before_bytes  # 字节真的换了
    assert after.file_size != before_size
    served = client.get(f"/api/scenario/admin/packs/{pack.key}/assets/swap_me")
    assert served.status_code == 200
    assert served.content == bytes(after.content)
    assert _pack_version(db) == version_after_upload + 1  # 声明变了 → 版本 +1
    # 未声明的资源不能"替换"（新增走上传）
    assert (
        client.post(
            f"/api/scenario/admin/packs/{pack.key}/assets/never_declared",
            files={"file": ("c.png", _solid_png((10, 200, 10)), "image/png")},
        ).status_code
        == 404
    )


# --------------------------------------------------------------------------- #
# 会话快照：改内容不影响已经在跑的局
# --------------------------------------------------------------------------- #


def test_session_snapshot_survives_pack_content_changes(app_client, installed) -> None:
    """**改内容后再回放旧局，结果不变**：开局时的内容进了会话行，之后与病例无关。

    新开一局才吃新内容（病例当前 version 与内容的唯一真实性仍由 `st_packs` 承担）。
    """
    client, holder, db = app_client
    pack, row = installed
    original_title = pack.title

    _student(client, holder)
    session_id, seq = _open_pack_session(client, pack.key)
    opened = client.get(f"/api/scenario/sessions/{session_id}").json()
    assert opened["view"]["pack"]["version"] == 1
    assert opened["view"]["pack"]["title"] == original_title
    snapshot = db.get(StSession, session_id).pack_content
    assert snapshot["title"] == original_title

    # 作者改内容（标题 + 线索文案）→ 当前内容 version +1
    _admin(client, holder)
    doc = client.get(f"/api/scenario/admin/packs/{pack.key}/content").json()["content"]
    doc["title"] = "改名后的病例"
    doc["setting"]["cues"][0]["text"] = "（改过的线索）"
    saved = client.post(f"/api/scenario/admin/packs/{pack.key}/content", json={"content": doc})
    assert saved.status_code == 200, saved.text
    assert saved.json()["version"] == 2

    # 旧局：视图/回放读的是它自己的快照，一个字都没变
    _student(client, holder)
    same = client.get(f"/api/scenario/sessions/{session_id}").json()
    assert same["view"]["pack"]["title"] == original_title
    assert same["view"]["pack"]["version"] == 1
    assert db.get(StSession, session_id).pack_content == snapshot
    # 而且照常可以继续
    turned = client.post(
        f"/api/scenario/sessions/{session_id}/turns",
        json={"request_id": "after-edit", "expected_seq": seq, "kind": "action", "affordance_id": "auscultate"},
    )
    assert turned.status_code == 200, turned.text
    holder["user"] = _FakeUser({"stats_view"})
    detail = client.get(f"/api/scenario/admin/sessions/{session_id}").json()
    assert detail["view"]["pack"]["title"] == original_title  # 管理侧回放同样读快照

    # 新开的局吃新内容
    _student(client, holder)
    fresh_id, _seq = _open_pack_session(client, pack.key)
    fresh = client.get(f"/api/scenario/sessions/{fresh_id}").json()
    assert fresh["view"]["pack"]["version"] == 2
    assert fresh["view"]["pack"]["title"] == "改名后的病例"
    assert row.version == 2
