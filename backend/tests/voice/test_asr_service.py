"""ASR 服务层与 WebSocket 鉴权 helper 的可测部分单测（无网络、无真实语音服务）。"""

from __future__ import annotations

from types import SimpleNamespace

import jwt
import pytest

from core.websocket_auth import authenticate_ws_token, resolve_ws_access
from infra.asr.protocol import BYTES_PER_SECOND
from modules.voice import asr_service
from modules.voice.asr_service import (
    AsrForbiddenError,
    AsrNotConfiguredError,
    assert_record_owner,
    estimate_cost,
    load_asr_api_key,
    write_asr_log,
)

SECRET = "test-secret-key-for-testing-only"


# ── 归属 / 配置 ──


class _FakeRecordQuery:
    def __init__(self, row):
        self._row = row
        self._filters: list = []

    def filter(self, *args):
        self._filters.append(args)
        return self

    def first(self):
        return self._row


class _FakeSession:
    def __init__(self, *, record_row=None, config=None):
        self._record_row = record_row
        self._config = config
        self.queries = 0

    def query(self, *entities):
        self.queries += 1
        if entities and getattr(entities[0], "__name__", "") == "VoiceConfig":
            return _FakeConfigQuery(self._config)
        return _FakeRecordQuery(self._record_row)


class _FakeConfigQuery:
    def __init__(self, config):
        self._config = config

    def filter(self, *args):
        return self

    def first(self):
        return self._config


class TestRecordOwnership:
    def test_owner_passes(self):
        assert_record_owner(_FakeSession(record_row=SimpleNamespace(user_id=7)), 1, 7)

    def test_other_users_record_is_forbidden(self):
        with pytest.raises(AsrForbiddenError):
            assert_record_owner(_FakeSession(record_row=SimpleNamespace(user_id=8)), 1, 7)

    def test_missing_record_is_forbidden(self):
        with pytest.raises(AsrForbiddenError):
            assert_record_owner(_FakeSession(record_row=None), 1, 7)


class TestLoadApiKey:
    def test_returns_active_key(self):
        db = _FakeSession(config=SimpleNamespace(api_key="sk-asr"))
        assert load_asr_api_key(db) == "sk-asr"

    def test_missing_config_raises_not_configured(self):
        with pytest.raises(AsrNotConfiguredError):
            load_asr_api_key(_FakeSession(config=None))

    def test_empty_key_raises_not_configured(self):
        with pytest.raises(AsrNotConfiguredError):
            load_asr_api_key(_FakeSession(config=SimpleNamespace(api_key="")))


# ── 计费估算 ──


class TestCostEstimate:
    def test_one_hour_of_audio_is_one_unit(self):
        assert estimate_cost(BYTES_PER_SECOND * 3600, "success") == pytest.approx(1.0)

    def test_thirty_seconds(self):
        assert estimate_cost(BYTES_PER_SECOND * 30, "success") == pytest.approx(round(30 / 3600, 6))

    def test_failure_still_billed_for_consumed_audio(self):
        assert estimate_cost(BYTES_PER_SECOND * 60, "error") == pytest.approx(round(60 / 3600, 6))

    @pytest.mark.parametrize("byte_count", [0, -1])
    def test_no_audio_no_cost(self, byte_count):
        assert estimate_cost(byte_count, "error") == 0.0


class TestWriteAsrLog:
    def test_writes_row_with_asr_direction(self, monkeypatch):
        captured = {}

        class _LogSession:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def add(self, row):
                captured["row"] = row

            def commit(self):
                captured["committed"] = True

        monkeypatch.setattr(asr_service, "SessionLocal", _LogSession)

        write_asr_log(
            user_id=3, record_id=11, audio_bytes=BYTES_PER_SECOND * 90, text_length=42, latency_ms=900, status="success"
        )

        row = captured["row"]
        assert row.direction == "asr"
        assert row.user_id == 3
        assert row.record_id == 11
        assert row.text_length == 42
        assert row.latency_ms == 900
        assert row.status == "success"
        assert row.cost_estimated == pytest.approx(round(90 / 3600, 6))
        assert captured["committed"] is True

    def test_failure_never_raises(self, monkeypatch):
        class _Broken:
            def __enter__(self):
                raise RuntimeError("db down")

            def __exit__(self, *exc):
                return False

        monkeypatch.setattr(asr_service, "SessionLocal", _Broken)
        write_asr_log(user_id=1, record_id=2, audio_bytes=10, text_length=0, latency_ms=5, status="error")

    def test_negative_text_length_clamped(self, monkeypatch):
        captured = {}

        class _LogSession:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def add(self, row):
                captured["row"] = row

            def commit(self):
                pass

        monkeypatch.setattr(asr_service, "SessionLocal", _LogSession)
        write_asr_log(user_id=1, record_id=2, audio_bytes=0, text_length=-3, latency_ms=-5, status="error")
        assert captured["row"].text_length == 0
        assert captured["row"].latency_ms == 0


# ── WS 鉴权 helper ──


class _UserQuery:
    def __init__(self, user):
        self._user = user

    def filter(self, *args):
        return self

    def first(self):
        return self._user


class _AuthSession:
    def __init__(self, user):
        self._user = user

    def query(self, *entities):
        return _UserQuery(self._user)

    def close(self):
        pass


def _fake_user(**fields):
    values = {"id": 12, "is_active": True, "token_version": 3}
    values.update(fields)
    user = SimpleNamespace(**values)
    user.has_permission = lambda perm: getattr(user, "_permissions", set()).__contains__(perm)
    user.set_permissions_cache = lambda perms: setattr(user, "_permissions", set(perms))
    return user


def _token(**claims):
    return jwt.encode({"user_id": 12, "tv": 3, **claims}, SECRET, algorithm="HS256")


class TestAuthenticateToken:
    def test_valid_token_returns_identity(self, monkeypatch):
        user = _fake_user()
        monkeypatch.setattr("core.websocket_auth.SessionLocal", lambda: _AuthSession(user))
        identity = authenticate_ws_token(_token())
        assert identity is not None
        assert (identity.user_id, identity.token_version) == (12, 3)

    def test_empty_token_rejected(self):
        assert authenticate_ws_token("") is None

    def test_garbage_token_rejected(self):
        assert authenticate_ws_token("not-a-jwt") is None

    def test_expired_token_rejected(self, monkeypatch):
        import datetime

        monkeypatch.setattr("core.websocket_auth.SessionLocal", lambda: _AuthSession(_fake_user()))
        token = jwt.encode(
            {"user_id": 12, "tv": 3, "exp": datetime.datetime.now(datetime.UTC) - datetime.timedelta(minutes=1)},
            SECRET,
            algorithm="HS256",
        )
        assert authenticate_ws_token(token) is None

    def test_non_int_user_id_rejected(self):
        token = jwt.encode({"user_id": "12", "tv": 3}, SECRET, algorithm="HS256")
        assert authenticate_ws_token(token) is None

    def test_token_version_mismatch_rejected(self, monkeypatch):
        monkeypatch.setattr("core.websocket_auth.SessionLocal", lambda: _AuthSession(_fake_user(token_version=4)))
        assert authenticate_ws_token(_token()) is None

    def test_inactive_user_rejected(self, monkeypatch):
        monkeypatch.setattr("core.websocket_auth.SessionLocal", lambda: _AuthSession(_fake_user(is_active=False)))
        assert authenticate_ws_token(_token()) is None

    def test_unknown_user_rejected(self, monkeypatch):
        monkeypatch.setattr("core.websocket_auth.SessionLocal", lambda: _AuthSession(None))
        assert authenticate_ws_token(_token()) is None


class TestResolveAccess:
    def test_training_access_granted(self, monkeypatch):
        user = _fake_user()
        monkeypatch.setattr("core.websocket_auth.SessionLocal", lambda: _AuthSession(user))
        monkeypatch.setattr(
            "core.websocket_auth._set_user_permissions",
            lambda u, db, p, s: u.set_permissions_cache({"training_access"}) or True,
        )
        assert resolve_ws_access(12) is True

    def test_missing_training_access_denied(self, monkeypatch):
        user = _fake_user()
        monkeypatch.setattr("core.websocket_auth.SessionLocal", lambda: _AuthSession(user))
        monkeypatch.setattr(
            "core.websocket_auth._set_user_permissions",
            lambda u, db, p, s: u.set_permissions_cache({"qa_access"}) or True,
        )
        assert resolve_ws_access(12) is False

    def test_unresolvable_context_denied(self, monkeypatch):
        user = _fake_user()
        monkeypatch.setattr("core.websocket_auth.SessionLocal", lambda: _AuthSession(user))
        monkeypatch.setattr("core.websocket_auth._set_user_permissions", lambda u, db, p, s: False)
        assert resolve_ws_access(12, persona="platform") is False

    def test_unknown_user_denied(self, monkeypatch):
        monkeypatch.setattr("core.websocket_auth.SessionLocal", lambda: _AuthSession(None))
        assert resolve_ws_access(12) is False


# ── 路由层纯逻辑 ──


class TestRouterHelpers:
    def test_stop_message_detected(self):
        from modules.voice.asr_router import _is_stop

        assert _is_stop('{"type": "stop"}') is True

    @pytest.mark.parametrize("text", ["", "stop", '{"type":"start"}', "[]", "{}", "not-json"])
    def test_non_stop_messages_ignored(self, text):
        from modules.voice.asr_router import _is_stop

        assert _is_stop(text) is False

    def test_outbox_drops_oldest_when_full(self):
        import asyncio

        from modules.voice.asr_router import _OUTBOX_MAX_CHUNKS, _offer

        outbox: asyncio.Queue = asyncio.Queue(maxsize=_OUTBOX_MAX_CHUNKS)
        for i in range(_OUTBOX_MAX_CHUNKS):
            _offer(outbox, bytes([i]))
        _offer(outbox, b"new")

        assert outbox.qsize() == _OUTBOX_MAX_CHUNKS
        items = [outbox.get_nowait() for _ in range(outbox.qsize())]
        assert items[0] == bytes([1])  # 最旧的一块被丢弃
        assert items[-1] == b"new"

    def test_audio_cap_is_ten_minutes(self):
        from modules.voice.asr_router import _MAX_AUDIO_BYTES

        assert _MAX_AUDIO_BYTES == BYTES_PER_SECOND * 600

    def test_close_codes_follow_shared_protocol(self):
        from core.websocket_auth import WS_CLOSE_FORBIDDEN, WS_CLOSE_UNAUTHORIZED
        from modules.voice import asr_router

        assert asr_router.WS_CLOSE_NOT_CONFIGURED == 4401
        assert WS_CLOSE_UNAUTHORIZED == 4001
        assert WS_CLOSE_FORBIDDEN == 4003
        assert asr_router.WS_CLOSE_UPSTREAM == 4500

    def test_route_path_is_same_origin_api(self):
        from modules.voice.asr_router import router

        paths = {getattr(r, "path", None) for r in router.routes}
        assert "/api/asr/stream" in paths
