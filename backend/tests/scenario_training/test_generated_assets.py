"""DM 现场生成物（`st_generated_assets`）：**存储与管理面**回归。

新机制里演出阶段没有生成图片的通道（docs/23 §4.4 固定了 `SceneDelivery` 形状），
所以这里不再断言"某个回合里请求了生成"——只守仍然存在的能力：字节入库/去重/按包分页/
预览/删除/权限门。数据直接构造，不经过模型。
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from core.database import get_db
from core.security import get_current_user
from models.scenario_training import StGeneratedAsset
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


@pytest.fixture
def api(pg_session, monkeypatch):
    from main import app

    monkeypatch.setattr(scenario_router, "SCENARIO_TRAINING_ENABLED", True)
    pack_loader.reset_cache()
    pack = pack_loader.load_pack_file(PACK_KEY)
    _, revision, _ = pack_loader.install(pg_session, pack)
    holder = {"user": _FakeUser({"scenario_training", "case_manage", "stats_view"})}
    before = dict(app.dependency_overrides)

    def _override_db():
        yield pg_session

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = lambda: holder["user"]
    try:
        yield TestClient(app), holder, pg_session, revision
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(before)
        pack_loader.reset_cache()


def _seed(db, *, session_id: int, revision_id: int, prompt: str, content: bytes, pack_key: str = PACK_KEY):
    row = assets_mod.store_generated_asset(
        db,
        session_id=session_id,
        pack_key=pack_key,
        pack_revision_id=revision_id,
        prompt=prompt,
        data=content,
    )
    db.flush()
    return row


def _png() -> bytes:
    return (assets_mod.ASSETS_ROOT / PACK_KEY / "room-panel.png").read_bytes()


def test_generated_bytes_are_stored_deduped_and_served(api) -> None:
    """同一会话同一份字节只留一行；管理面预览与字节一致。"""
    client, holder, db, revision = api
    first = _seed(db, session_id=1, revision_id=revision.id, prompt="p", content=_png())
    again = _seed(db, session_id=1, revision_id=revision.id, prompt="p", content=_png())
    assert again.id == first.id
    assert db.query(StGeneratedAsset).filter(StGeneratedAsset.session_id == 1).count() == 1

    holder["user"] = _FakeUser({"case_manage"})
    preview = client.get(f"/api/scenario/admin/generated/{first.id}/content")
    assert preview.status_code == 200
    stored = assets_mod.get_generated_asset(db, first.id)
    assert stored is not None
    assert preview.content == bytes(stored.content)
    assert preview.headers["content-type"] == stored.mime_type


def test_admin_list_is_pack_scoped_and_paginated(api) -> None:
    """列表按病例作用域 + 分页（`total` 是该作用域下的总数）。"""
    client, holder, db, revision = api
    _seed(db, session_id=1, revision_id=revision.id, prompt="one", content=_png())
    _seed(db, session_id=2, revision_id=revision.id, prompt="two", content=_png())
    _seed(db, session_id=3, revision_id=revision.id, prompt="other", content=_png(), pack_key="another-pack")

    holder["user"] = _FakeUser({"case_manage"})
    listing = client.get(f"/api/scenario/admin/packs/{PACK_KEY}/generated?limit=1").json()
    assert listing["total"] == 2
    assert len(listing["items"]) == 1
    assert listing["items"][0]["pack_key"] == PACK_KEY
    assert "content" not in listing["items"][0]  # 列表不带字节


def test_delete_removes_bytes_and_serving_404s(api) -> None:
    client, holder, db, revision = api
    row = _seed(db, session_id=1, revision_id=revision.id, prompt="p", content=_png())
    holder["user"] = _FakeUser({"case_manage"})
    assert client.delete(f"/api/scenario/admin/generated/{row.id}").status_code == 200
    assert client.get(f"/api/scenario/admin/generated/{row.id}/content").status_code == 404
    assert assets_mod.get_generated_asset(db, row.id) is None


def test_generated_surface_requires_case_manage(api) -> None:
    client, holder, db, revision = api
    row = _seed(db, session_id=1, revision_id=revision.id, prompt="p", content=_png())
    holder["user"] = _FakeUser({"scenario_training"})  # 学生键不够
    assert client.get(f"/api/scenario/admin/packs/{PACK_KEY}/generated").status_code == 403
    assert client.get(f"/api/scenario/admin/generated/{row.id}/content").status_code == 403
