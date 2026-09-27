"""DM 现场生成物（`st_generated_assets`）的回归：入库 / 去重 / 分页 / 删除 / 权限。

守的是"消费者可见的行为"：DM 生成的图必须**落在库里**（容器重建不丢、管理端看得见）、
能原样取回、重复请求不重复存、管理端能分页看到并删除。
"""

from __future__ import annotations

import hashlib
import io
import json
from typing import TYPE_CHECKING, Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from core.database import get_db
from core.security import get_current_user
from models.scenario_training import StGeneratedAsset
from modules.scenario_training import assets as assets_mod
from modules.scenario_training import pack_loader
from modules.scenario_training import router as scenario_router

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

PACK_KEY = "sputum-ineffective"
PROMPT = "夜班病房，氧气瓶，冷色光"

_LIST_FIELDS = {
    "id",
    "session_id",
    "pack_key",
    "pack_revision_id",
    "kind",
    "prompt",
    "mime_type",
    "file_size",
    "sha256",
    "created_at",
}


def _png(color: tuple[int, int, int] = (10, 20, 30)) -> bytes:
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (48, 32), color).save(buffer, "PNG")
    return buffer.getvalue()


class _FakeProvider:
    """假绘画者 AI：记调用次数与返回字节，方便断言"没白花钱"与"字节原样入库"。"""

    def __init__(self) -> None:
        self.calls = 0
        self.last: bytes = b""

    async def generate(self, prompt: str) -> bytes:
        self.calls += 1
        self.last = _png((self.calls * 40 % 256, 20, 30))
        return self.last


class _FakeLLM:
    """每回合都要一张生成图的 DM。"""

    def __init__(self, prompt: str) -> None:
        self.turn = {
            "narration": "灯光很暗。",
            "image_request": {"prompt": prompt, "caption": "现场"},
        }

    async def call(self, messages: list[dict[str, str]], **_: Any) -> str:
        return json.dumps(self.turn, ensure_ascii=False)


class _FakeUser:
    def __init__(self, permissions: set[str] | None = None) -> None:
        self.id = 4242
        self.role_id = 1
        self.token_version = 1
        self.role = type("_Role", (), {"name": "teacher"})()
        self._permissions = permissions or set()

    def has_permission(self, key: str) -> bool:
        return key in self._permissions


@pytest.fixture
def app_client(pg_session, monkeypatch):
    from main import app

    def _override_db():
        yield pg_session

    monkeypatch.setattr(scenario_router, "SCENARIO_TRAINING_ENABLED", True)
    pack_loader.reset_cache()
    holder = {"user": _FakeUser({"case_manage", "stats_view"}), "provider": _FakeProvider()}
    overrides_before = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = lambda: holder["user"]
    original_llm = getattr(app.state, "llm_client", None)
    original_provider = getattr(app.state, "scenario_image_provider", None)
    app.state.llm_client = _FakeLLM(PROMPT)
    app.state.scenario_image_provider = holder["provider"]
    try:
        yield TestClient(app), holder, pg_session
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(overrides_before)  # 不破坏其他测试的覆盖
        app.state.llm_client = original_llm
        app.state.scenario_image_provider = original_provider
        pack_loader.reset_cache()


@pytest.fixture
def installed(pg_session):
    """仓库里的包默认**禁止**现场生成；测试装一个显式允许的修订。"""
    pack = pack_loader.load_pack_file(PACK_KEY).model_copy(update={"image_generation": "allowed"})
    _, revision, _ = pack_loader.install(pg_session, pack)
    return pack, revision


def _open(client: TestClient) -> dict[str, Any]:
    opened = client.post("/api/scenario/sessions", json={"pack_key": PACK_KEY})
    assert opened.status_code == 200, opened.text
    return opened.json()


def _rows(db, session_id: int) -> list[StGeneratedAsset]:
    return list(
        db.execute(
            select(StGeneratedAsset).where(StGeneratedAsset.session_id == session_id).order_by(StGeneratedAsset.id)
        )
        .scalars()
        .all()
    )


def test_generation_is_stored_in_db_and_served_back(app_client, installed) -> None:
    """开场生成 → 库里有一行（字节 == 归一后的提供方字节），且接口取回同样字节。"""
    client, holder, db = app_client
    pack, revision = installed
    body = _open(client)
    session_id = body["session_id"]

    image = body["view"]["images"][0]
    assert image["origin"] == "generated"
    assert image["asset_id"].startswith("gen:")
    assert image["url"] == f"/api/scenario/assets/{revision.id}/{image['asset_id']}"

    rows = _rows(db, session_id)
    assert len(rows) == 1
    row = rows[0]
    assert row.pack_key == PACK_KEY
    assert row.pack_revision_id == revision.id
    assert row.kind == "image"
    assert row.prompt == PROMPT
    assert row.mime_type == "image/webp"  # 与上传同一归一：统一 WebP、剥元数据
    assert row.file_size == len(row.content) > 0
    assert row.sha256 == hashlib.sha256(bytes(row.content)).hexdigest()
    assert bytes(row.content) == assets_mod.normalize_image(holder["provider"].last)[0]
    assert image["asset_id"] == assets_mod.generated_asset_id(row.id)

    served = client.get(image["url"])
    assert served.status_code == 200, served.text
    assert served.headers["content-type"].startswith("image/webp")
    assert served.content == bytes(row.content)

    # 磁盘上不再有缓存目录（字节只存在库里）
    assert bytes(row.content)[:4] == b"RIFF", "生成图也应是归一后的 WebP"


def test_same_session_same_prompt_stores_once(app_client, installed) -> None:
    """同一会话重复请求同图：不产生第二行，也不再花一次生成成本。"""
    client, holder, db = app_client
    first = _open(client)
    session_id = first["session_id"]
    asset_id = first["view"]["images"][0]["asset_id"]
    assert holder["provider"].calls == 1

    acted = client.post(f"/api/scenario/sessions/{session_id}/actions", json={"affordance_id": "measure_spo2"})
    assert acted.status_code == 200, acted.text
    assert acted.json()["view"]["images"][0]["asset_id"] == asset_id
    assert holder["provider"].calls == 1, "同提示词不该再调一次提供方"
    assert len(_rows(db, session_id)) == 1


def test_duplicate_bytes_in_one_session_collapse_to_one_row(app_client, installed, monkeypatch) -> None:
    """同一会话同一份字节只留一行：即使 sha 预查漏了（并发），也靠唯一约束回落到已有行。"""
    client, _holder, db = app_client
    _pack, revision = installed
    session_id = _open(client)["session_id"]
    first = assets_mod.store_generated_asset(
        db,
        session_id=session_id,
        pack_key=PACK_KEY,
        pack_revision_id=revision.id,
        prompt="原始提示词",
        data=_png((7, 7, 7)),
    )
    db.flush()

    missing_once = {"done": False}
    real = assets_mod._generated_by_sha

    def _miss_once(db_: Session, *, session_id: int, digest: str) -> StGeneratedAsset | None:
        """只替第一次预查：让 sha 预查漏掉，逼出唯一约束 + 回落路径。"""
        if not missing_once["done"]:
            missing_once["done"] = True
            return None
        return real(db_, session_id=session_id, digest=digest)

    monkeypatch.setattr(assets_mod, "_generated_by_sha", _miss_once)
    second = assets_mod.store_generated_asset(
        db,
        session_id=session_id,
        pack_key=PACK_KEY,
        pack_revision_id=revision.id,
        prompt="同图另一次请求",
        data=_png((7, 7, 7)),
    )
    assert missing_once["done"] is True
    assert second.id == first.id
    assert len([row for row in _rows(db, session_id) if row.sha256 == first.sha256]) == 1


def test_admin_list_is_pack_scoped_and_paginated(app_client, installed) -> None:
    """列表：按 pack 过滤后分页、带总数、**不含字节**；非法参数被拒。"""
    client, holder, db = app_client
    pack, revision = installed
    session_id = _open(client)["session_id"]
    for index in range(2):  # 再造两条（不同字节 → 不同行）
        assets_mod.store_generated_asset(
            db,
            session_id=session_id,
            pack_key=PACK_KEY,
            pack_revision_id=revision.id,
            prompt=f"{PROMPT}#{index}",
            data=_png((index * 60 + 5, 5, 5)),
        )
    db.flush()

    first = client.get(f"/api/scenario/admin/packs/{PACK_KEY}/generated?limit=2&offset=0")
    assert first.status_code == 200, first.text
    page = first.json()
    assert page["total"] == 3
    assert len(page["items"]) == 2
    assert set(page["items"][0]) == _LIST_FIELDS  # 只有元数据，没有字节
    assert all(item["pack_key"] == PACK_KEY for item in page["items"])
    assert page["items"][0]["id"] > page["items"][1]["id"], "新的在前"

    second = client.get(f"/api/scenario/admin/packs/{PACK_KEY}/generated?limit=2&offset=2").json()
    assert second["total"] == 3
    assert len(second["items"]) == 1
    assert {item["id"] for item in page["items"]} & {item["id"] for item in second["items"]} == set()

    only_session = client.get(f"/api/scenario/admin/packs/{PACK_KEY}/generated?session_id={session_id}").json()
    assert only_session["total"] == 3
    assert client.get(f"/api/scenario/admin/packs/{PACK_KEY}/generated?session_id={session_id + 999}").json() == {
        "items": [],
        "total": 0,
    }

    assert client.get(f"/api/scenario/admin/packs/{PACK_KEY}/generated?limit=0").status_code == 422
    assert client.get(f"/api/scenario/admin/packs/{PACK_KEY}/generated?limit=101").status_code == 422
    assert client.get(f"/api/scenario/admin/packs/{PACK_KEY}/generated?offset=-1").status_code == 422
    assert client.get("/api/scenario/admin/packs/no-such-pack/generated").status_code == 404
    assert holder["provider"].calls == 1


def test_admin_content_preview_matches_student_route(app_client, installed) -> None:
    client, _holder, db = app_client
    _pack, revision = installed
    body = _open(client)
    asset_id = body["view"]["images"][0]["asset_id"]
    row = _rows(db, body["session_id"])[0]

    preview = client.get(f"/api/scenario/admin/generated/{row.id}/content")
    assert preview.status_code == 200, preview.text
    assert preview.content == bytes(row.content)
    assert preview.content == client.get(f"/api/scenario/assets/{revision.id}/{asset_id}").content
    assert "max-age=" in preview.headers["cache-control"]
    assert client.get(f"/api/scenario/admin/generated/{row.id + 999}/content").status_code == 404


def test_delete_removes_bytes_and_serving_404s(app_client, installed) -> None:
    client, _holder, db = app_client
    _pack, revision = installed
    body = _open(client)
    asset_id = body["view"]["images"][0]["asset_id"]
    row = _rows(db, body["session_id"])[0]

    deleted = client.delete(f"/api/scenario/admin/generated/{row.id}")
    assert deleted.status_code == 200, deleted.text
    assert deleted.json() == {"deleted": row.id}
    assert _rows(db, body["session_id"]) == []
    assert client.get(f"/api/scenario/admin/generated/{row.id}/content").status_code == 404
    assert client.get(f"/api/scenario/assets/{revision.id}/{asset_id}").status_code == 404
    assert client.delete(f"/api/scenario/admin/generated/{row.id}").status_code == 404


def test_generated_asset_is_pack_scoped(app_client, installed) -> None:
    """一条生成物只服务它所属的 pack：换个包的同名 id 取不到。"""
    client, _holder, db = app_client
    _pack, _revision = installed
    body = _open(client)
    row = _rows(db, body["session_id"])[0]

    other = pack_loader.load_pack_file("two_beds_priority")
    with pytest.raises(assets_mod.AssetNotFound):
        assets_mod.read_image(db, other, assets_mod.generated_asset_id(row.id))
    with pytest.raises(assets_mod.AssetNotFound):
        assets_mod.read_image(db, other, "gen:not-a-row-id")


def test_generation_is_skipped_without_provider(app_client, installed) -> None:
    """没接绘画者 AI：不生成占位假图、不写库，只在问题清单里如实记一条。"""
    from main import app

    client, holder, db = app_client
    app.state.scenario_image_provider = None
    body = _open(client)
    assert body["view"]["images"] == []
    assert db.execute(select(StGeneratedAsset)).scalars().all() == []

    detail = client.get(f"/api/scenario/admin/sessions/{body['session_id']}").json()
    assert "image_generation_unavailable" in detail["problems"]
    assert holder["provider"].calls == 0


def test_generated_admin_surface_requires_case_manage(app_client, installed) -> None:
    client, holder, _db = app_client
    _pack, revision = installed
    body = _open(client)
    row = _rows(_db, body["session_id"])[0]

    for permissions in (set(), {"stats_view"}):
        holder["user"] = _FakeUser(set(permissions))
        assert client.get(f"/api/scenario/admin/packs/{PACK_KEY}/generated").status_code == 403
        assert client.get(f"/api/scenario/admin/generated/{row.id}/content").status_code == 403
        assert client.delete(f"/api/scenario/admin/generated/{row.id}").status_code == 403

    holder["user"] = _FakeUser({"case_manage"})
    assert client.get(f"/api/scenario/admin/packs/{PACK_KEY}/generated").status_code == 200
    assert client.delete(f"/api/scenario/admin/generated/{row.id}").status_code == 200
    assert revision.id > 0
