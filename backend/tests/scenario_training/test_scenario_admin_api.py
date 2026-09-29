"""管理侧的两条消费者可见不变量：**上架门**与**会话内容快照**。

其余管理面行为（上传/资源/编辑器/复制/删除/统计）的形状与文案不在这里钉，交给真跑一次。
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from core.database import get_db
from core.security import get_current_user
from models.scenario_training import StSession
from modules.scenario_training import assets as assets_mod
from modules.scenario_training import case_folder, pack_loader
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
    """限流不在这一层测；这里不碰真限流表。"""


class _FakeLLM:
    """单循环 agent 的最小桩：先让患者说一句，再交付。"""

    def __init__(self) -> None:
        self.rounds: list[list[tuple[str, dict]]] = [
            [("char_say", {"actor": "patient", "text": "……", "as_role": None})]
        ]
        self.narration = "你把手套戴好，床边的机器还在响。"

    async def call_with_tools(self, messages, tools, tool_handlers, **_: object) -> str:
        del messages, tools
        for batch in self.rounds:
            for name, args in batch:
                tool_handlers[name](args)
        tool_handlers["deliver"]({"narration": self.narration})
        return ""


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
    pack, images = pack_loader.load_case(PACK_KEY)
    row, _changed = pack_loader.install(pg_session, pack)
    assets_mod.seed_assets(pg_session, pack, images, overwrite=True)
    return pack, row


def _student(client, holder) -> None:
    holder["user"] = _FakeUser({"scenario_training"})


def _admin(client, holder) -> None:
    holder["user"] = _FakeUser({"case_manage", "stats_view", "scenario_training"})


def _open_pack_session(client, key: str) -> tuple[int, int]:
    opened = client.post("/api/scenario/sessions", json={"pack_key": key})
    assert opened.status_code == 200, opened.text
    return opened.json()["session_id"], opened.json()["view"]["session"]["seq"]


def test_publish_gate_hides_unpublished_without_breaking_running_sessions(app_client, installed) -> None:
    """上架后学生可见可开；下架后学生列表里没有、开不了新局，但**进行中的会话照常继续**。"""
    client, holder, _db = app_client
    pack, _row = installed
    _student(client, holder)
    session_id, seq = _open_pack_session(client, pack.key)

    _admin(client, holder)
    assert client.post(f"/api/scenario/admin/packs/{pack.key}/unpublish").json()["published"] is False

    _student(client, holder)
    assert pack.key not in [row["key"] for row in client.get("/api/scenario/packs").json()]
    blocked = client.post("/api/scenario/sessions", json={"pack_key": pack.key})
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "pack_unpublished"

    # 下架不打断进行中的会话：老会话照常可读、可继续
    assert client.get(f"/api/scenario/sessions/{session_id}").status_code == 200
    turned = client.post(
        f"/api/scenario/sessions/{session_id}/turns",
        json={"request_id": "after-unpublish", "expected_seq": seq, "kind": "action", "affordance_id": "auscultate"},
    )
    assert turned.status_code == 200, turned.text
    assert turned.json()["outcome"] == "performed"

    # 重新上架 → 学生又能看见、能开新局
    _admin(client, holder)
    assert client.post(f"/api/scenario/admin/packs/{pack.key}/publish").json()["published"] is True
    _student(client, holder)
    assert pack.key in [row["key"] for row in client.get("/api/scenario/packs").json()]
    assert client.post("/api/scenario/sessions", json={"pack_key": pack.key}).status_code == 200


def test_session_snapshot_survives_pack_content_changes(app_client, installed) -> None:
    """**改内容后再回放旧局，结果不变**：开局时的内容进了会话行，之后与病例无关。

    新开一局才吃新内容（病例当前 version 与内容的唯一真实性仍由 `st_packs` 承担）。
    """
    client, holder, db = app_client
    pack, row = installed
    original_title = pack.title

    _student(client, holder)
    session_id, seq = _open_pack_session(client, pack.key)
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

    # 旧局：视图/回放读的是它自己的快照，一个字都没变，而且照常可以继续
    _student(client, holder)
    same = client.get(f"/api/scenario/sessions/{session_id}").json()
    assert same["view"]["pack"]["title"] == original_title
    assert db.get(StSession, session_id).pack_content == snapshot
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
    assert fresh["view"]["pack"]["title"] == "改名后的病例"
    assert row.version == 2


# --------------------------------------------------------------------------- #
# 病例包（标准模板 / 导入 / 导出）：三个 zip 端点 + 旧 JSON 上传路径已消失
# --------------------------------------------------------------------------- #


def test_standard_template_can_be_imported_back(app_client) -> None:
    """下载标准模板 → 导入成新病例（默认上架，可直接开新局）。"""
    client, holder, _db = app_client
    _admin(client, holder)

    template = client.get("/api/scenario/admin/cases/standard.zip", params={"key": "tpl-case", "title": "模板病例"})
    assert template.status_code == 200, template.text
    assert template.headers["content-type"] == "application/zip"
    assert template.content[:2] == b"PK"

    imported = client.post(
        "/api/scenario/admin/packs/import",
        files={"files": ("tpl-case.zip", template.content, "application/zip")},
    )
    assert imported.status_code == 200, imported.text
    body = imported.json()
    assert (body["key"], body["title"], body["version"], body["changed"]) == ("tpl-case", "模板病例", 1, True)
    assert body["problems"] == []

    _student(client, holder)
    assert client.post("/api/scenario/sessions", json={"pack_key": "tpl-case"}).status_code == 200


def test_import_accepts_plain_files_and_tolerates_extra(app_client) -> None:
    """前端按相对路径传一组文件（`webkitdirectory`）：多余的忽略并提示，病例照样装进来。"""
    client, holder, _db = app_client
    _admin(client, holder)
    files = case_folder.case_files(*pack_loader.load_case(PACK_KEY))
    files["note.txt"] = "作者随手放的备注".encode()

    imported = client.post(
        "/api/scenario/admin/packs/import",
        files=[("files", (f"my-case/{name}", data, "application/octet-stream")) for name, data in files.items()],
    )
    assert imported.status_code == 200, imported.text
    body = imported.json()
    assert body["key"] == PACK_KEY
    assert body["changed"] is True
    assert any("note.txt" in problem for problem in body["problems"])

    # 同一份内容再导入一次：幂等，不涨版本
    again = client.post(
        "/api/scenario/admin/packs/import",
        files=[("files", (f"my-case/{name}", data, "application/octet-stream")) for name, data in files.items()],
    ).json()
    assert again["version"] == body["version"]
    assert again["changed"] is False


def test_import_of_broken_toml_says_why(app_client) -> None:
    client, holder, _db = app_client
    _admin(client, holder)
    broken = client.post(
        "/api/scenario/admin/packs/import",
        files={"files": ("case.toml", b'key = "x"\ntitle = "y\n', "application/toml")},
    )
    assert broken.status_code == 422
    assert "case.toml 解析失败" in broken.json()["detail"]["message"]


def test_export_zip_is_lossless_including_image_bytes(app_client, installed) -> None:
    """导出：内容与磁盘上那一份逐字段一致，图片字节原样（不重编码）。"""
    client, holder, _db = app_client
    pack, _row = installed
    _admin(client, holder)

    exported = client.get(f"/api/scenario/admin/packs/{PACK_KEY}/export.zip")
    assert exported.status_code == 200
    parsed = case_folder.parse_files(case_folder.unzip_files(exported.content))
    assert pack_loader.pack_from_content(parsed.content) == pack
    assert parsed.images == case_folder.images_of(PACK_KEY)
    assert parsed.images["room-panel.png"] == (case_folder.CASES_DIR / PACK_KEY / "img" / "room-panel.png").read_bytes()


def test_json_upload_path_is_gone(app_client) -> None:
    """旧的 JSON 上传路径（`POST /admin/packs`）已删除：替代彻底，不留双轨。"""
    client, holder, _db = app_client
    _admin(client, holder)
    gone = client.post("/api/scenario/admin/packs", files={"file": ("pack.json", b"{}", "application/json")})
    assert gone.status_code == 405
