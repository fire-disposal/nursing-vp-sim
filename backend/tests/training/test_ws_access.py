"""训练 WS 的访问上下文（``modules/training/router/ws.py``）。

回归：平台账号在训练页用「学生视角」训练时，WS 连接若不带视角/院校，服务端会按**默认视角**
解析 —— 平台账号的默认视角是 ``ops``，它没有 ``training_access``，于是连接被 4003 关掉，
前端横幅「实时推送连接中断」并持续重连。视角/院校必须随连接传入，语义同 HTTP 请求头
（``X-View-Persona`` / ``X-School-Scope``）。
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from core.database import SessionLocal
from core.security import create_access_token
from models import School, User
from modules.training.router import ws as ws_module


class _StubHub:
    """路由只用到 subscribe/unsubscribe；本用例不接 PG LISTEN/NOTIFY。"""

    async def subscribe(self, user_id: int) -> asyncio.Queue:
        return asyncio.Queue()

    def unsubscribe(self, user_id: int, queue: asyncio.Queue) -> None:
        pass


@pytest.fixture
def platform_user():
    """平台账号：派生全部视角，默认视角却是 ``ops``（无 ``training_access``）。"""
    db = SessionLocal()
    now = datetime.now(UTC)
    school = School(name=f"ws-access-{uuid4().hex[:8]}", created_at=now)
    db.add(school)
    db.flush()
    user = User(
        username=f"ws-access-{uuid4().hex[:8]}",
        password_hash="x",
        display_name="平台账号",
        school_id=school.id,
        is_superadmin=True,
        created_at=now,
        updated_at=now,
    )
    db.add(user)
    db.commit()
    try:
        yield user, school, create_access_token({"user_id": user.id, "tv": user.token_version})
    finally:
        db.delete(user)
        db.delete(school)
        db.commit()
        db.close()


def _client() -> TestClient:
    app = FastAPI()
    app.state.realtime_hub = _StubHub()
    app.include_router(ws_module.router, prefix="/api/training")
    return TestClient(app)


def test_persona_and_school_context_is_accepted(platform_user) -> None:
    """平台账号带「学生视角 + 院校」连 WS：过了鉴权，ping 能得到 pong。"""
    _user, school, token = platform_user
    client = _client()
    with client.websocket_connect(f"/api/training/ws?token={token}&persona=student&school={school.id}") as ws:
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}


def test_default_persona_without_context_has_no_training_access(platform_user) -> None:
    """不带视角/院校 = 默认 ``ops`` 视角 → 4003（这是修复前的线上行为）。"""
    _user, _school, token = platform_user
    client = _client()
    with (
        pytest.raises(WebSocketDisconnect) as exc,
        client.websocket_connect(f"/api/training/ws?token={token}") as ws,
    ):
        ws.receive_json()
    assert exc.value.code == 4003
