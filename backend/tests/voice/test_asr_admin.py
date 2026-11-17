"""ASR 管理后端：独立凭据、掩码、配置更新、用量聚合、连通性测试。

纯单测/内容检查 + 一个走测试库的聚合用例；**从不**连火山、不发音频。
"""

from __future__ import annotations

import asyncio
import importlib.util
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest

from core.database import Base
from core.tenant import platform_scope
from infra.asr.client import ASR_RESOURCE_ID
from models import VoiceCallLog, VoiceConfig
from modules.admin.costs import CostService
from modules.admin.voice import VoiceConfigService, _build_voice_config_response
from modules.voice.asr_service import AsrNotConfiguredError, load_asr_api_key
from schemas.voice import AsrStatusResponse, VoiceConfigResponse, VoiceConfigUpdateRequest, VoiceUsageResponse

# ── 假对象 ──


class _ConfigQuery:
    def __init__(self, config):
        self._config = config

    def filter(self, *args):
        return self

    def first(self):
        return self._config

    def order_by(self, *args):
        return self


class _FakeDb:
    """只够 ``load_asr_api_key`` 用：query(VoiceConfig).filter(...).first()。"""

    def __init__(self, config):
        self._config = config

    def query(self, *entities):
        return _ConfigQuery(self._config)


class _FakeAsrSession:
    """记录调用顺序的 AsrSession 替身；``fail_at`` 决定在哪一步抛错。"""

    def __init__(self, *, fail_at: str | None = None, error: Exception | None = None):
        self.fail_at = fail_at
        self.error = error or RuntimeError("上游炸了")
        self.calls: list[str] = []
        self.closed = False

    async def connect(self) -> None:
        self.calls.append("connect")
        if self.fail_at == "connect":
            raise self.error

    async def send_full_request(self) -> None:
        self.calls.append("send_full_request")
        if self.fail_at == "send":
            raise self.error

    async def close(self) -> None:
        self.calls.append("close")
        self.closed = True


# ── 独立 Key ──


class TestIndependentAsrKey:
    def test_reads_asr_api_key(self):
        db = _FakeDb(SimpleNamespace(api_key="tts-key", asr_api_key="asr-key"))
        assert load_asr_api_key(db) == "asr-key"

    def test_never_falls_back_to_tts_key(self):
        """TTS Key 已配但 ASR Key 为空 → 未配置，绝不借用 TTS 的 Key。"""
        db = _FakeDb(SimpleNamespace(api_key="tts-key", asr_api_key=""))
        with pytest.raises(AsrNotConfiguredError) as ei:
            load_asr_api_key(db)
        assert "tts-key" not in str(ei.value)

    def test_missing_config_raises(self):
        with pytest.raises(AsrNotConfiguredError):
            load_asr_api_key(_FakeDb(None))

    def test_error_message_mentions_independent_key(self):
        with pytest.raises(AsrNotConfiguredError) as ei:
            load_asr_api_key(_FakeDb(SimpleNamespace(api_key="tts-key", asr_api_key="")))
        assert "ASR" in str(ei.value)

    def test_tts_service_still_reads_tts_key(self):
        """TTS 侧口径不变：model 上的 api_key 与 asr_api_key 是两个字段。"""
        vc = VoiceConfig(api_key="tts-key", asr_api_key="asr-key")
        assert vc.api_key == "tts-key"
        assert vc.asr_api_key == "asr-key"


# ── 掩码与响应 ──


class TestMasking:
    def _response(self, **fields) -> VoiceConfigResponse:
        base = dict(
            id=1,
            provider="volcengine",
            api_key="tts-key-1234",
            asr_api_key="asr-key-9876",
            tts_speaker="zh_female_vv_uranus_bigtts",
            tts_resource_id="seed-tts-2.0",
            tts_model="seed-tts-2.0-standard",
            tts_sample_rate=24000,
            tts_format="mp3",
            tts_timeout=8,
            monthly_budget=200.0,
            is_active=True,
            speaker_library=None,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        base.update(fields)
        return _build_voice_config_response(VoiceConfig(**base))

    def test_masks_are_independent(self):
        r = self._response()
        assert r.api_key_masked.endswith("1234")
        assert r.asr_api_key_masked.endswith("9876")
        assert r.api_key_suffix == "1234"
        assert r.asr_api_key_suffix == "9876"

    def test_full_keys_never_returned(self):
        r = self._response()
        payload = r.model_dump_json()
        assert "tts-key-1234" not in payload
        assert "asr-key-9876" not in payload

    def test_unset_asr_key(self):
        r = self._response(asr_api_key="")
        assert r.asr_api_key_masked == "未设置"
        assert r.asr_api_key_suffix == ""
        # TTS 的掩码不受影响
        assert r.api_key_masked.endswith("1234")

    def test_short_key_is_fully_masked(self):
        r = self._response(asr_api_key="short")
        assert r.asr_api_key_masked == "***...***"
        assert "short" not in r.asr_api_key_masked


# ── 配置更新（DB） ──


class TestConfigUpdate:
    def test_update_sets_asr_key_without_touching_tts_key(self, pg_session):
        vc = VoiceConfig(api_key="tts-key-1234", asr_api_key="", provider="volcengine")
        pg_session.add(vc)
        pg_session.flush()

        resp = VoiceConfigService(pg_session).update_config({"asr_api_key": "asr-new-5678"})

        pg_session.refresh(vc)
        assert vc.asr_api_key == "asr-new-5678"
        assert vc.api_key == "tts-key-1234"
        assert resp.asr_api_key_masked.endswith("5678")
        assert resp.api_key_suffix == "1234"

    def test_update_tts_key_leaves_asr_key(self, pg_session):
        vc = VoiceConfig(api_key="tts-old-1111", asr_api_key="asr-key-9876", provider="volcengine")
        pg_session.add(vc)
        pg_session.flush()

        resp = VoiceConfigService(pg_session).update_config({"api_key": "tts-new-2222"})

        pg_session.refresh(vc)
        assert vc.api_key == "tts-new-2222"
        assert vc.asr_api_key == "asr-key-9876"
        assert resp.asr_api_key_suffix == "9876"

    def test_update_without_keys_keeps_both(self, pg_session):
        vc = VoiceConfig(api_key="tts-key-1234", asr_api_key="asr-key-9876", provider="volcengine")
        pg_session.add(vc)
        pg_session.flush()
        VoiceConfigService(pg_session).update_config({"monthly_budget": 300.0})
        pg_session.refresh(vc)
        assert (vc.api_key, vc.asr_api_key, vc.monthly_budget) == ("tts-key-1234", "asr-key-9876", 300.0)

    def test_request_schema_accepts_asr_key_and_defaults_to_none(self):
        assert VoiceConfigUpdateRequest().asr_api_key is None
        assert VoiceConfigUpdateRequest(asr_api_key="asr-key").asr_api_key == "asr-key"


# ── 连通性测试（fake session） ──


class _ServiceStub(VoiceConfigService):
    """绕过 DB 查询：直接指定 active 配置 + 只够 ``load_asr_api_key`` 用的假 db。"""

    def __init__(self, config):
        self._config = config
        self.db = _FakeDb(config)

    def _get_active(self):
        return self._config


class TestTestAsr:
    def _vc(self, asr_key="asr-key-9876"):
        return SimpleNamespace(provider="volcengine", asr_api_key=asr_key)

    def _run(self, service, **session_kw):
        fake = _FakeAsrSession(**session_kw)
        result = asyncio.run(service.test_asr(session_factory=lambda key: fake))
        return result, fake

    def test_success_touches_no_audio(self):
        result, fake = self._run(_ServiceStub(self._vc()))
        assert isinstance(result, AsrStatusResponse)
        assert result.asr_online is True
        assert result.last_error is None
        assert result.last_error_at is None
        assert result.resource_id == ASR_RESOURCE_ID == "volc.seedasr.sauc.duration"
        # 只连接 + 配置帧 + 关闭，绝不发音频 / finish
        assert fake.calls == ["connect", "send_full_request", "close"]
        assert fake.closed is True

    def test_key_is_passed_through(self):
        seen = {}

        def factory(key):
            seen["key"] = key
            return _FakeAsrSession()

        asyncio.run(_ServiceStub(self._vc()).test_asr(session_factory=factory))
        assert seen["key"] == "asr-key-9876"

    def test_connect_failure_reported_and_closed(self):
        result, fake = self._run(_ServiceStub(self._vc()), fail_at="connect")
        assert result.asr_online is False
        assert result.last_error
        assert result.last_error_at is not None
        assert result.resource_id == ASR_RESOURCE_ID
        assert fake.closed is True

    def test_config_frame_rejection_reported(self):
        result, fake = self._run(_ServiceStub(self._vc()), fail_at="send")
        assert result.asr_online is False
        assert result.last_error
        assert fake.calls == ["connect", "send_full_request", "close"]

    def test_error_never_contains_key(self):
        err = RuntimeError("handshake failed for asr-key-9876 (X-Api-Key: asr-key-9876)")
        result, _ = self._run(_ServiceStub(self._vc()), fail_at="connect", error=err)
        assert result.asr_online is False
        assert "asr-key-9876" not in (result.last_error or "")
        assert "***" in (result.last_error or "")

    def test_missing_key_reports_not_configured_without_connecting(self):
        called = []
        service = _ServiceStub(self._vc(asr_key=""))
        result = asyncio.run(service.test_asr(session_factory=lambda key: called.append(key)))
        assert result.asr_online is False
        assert result.last_error
        assert result.resource_id == ASR_RESOURCE_ID
        assert called == []

    def test_tts_key_not_used_when_asr_key_missing(self):
        called = []
        vc = SimpleNamespace(provider="volcengine", api_key="tts-key-1234", asr_api_key="")
        result = asyncio.run(_ServiceStub(vc).test_asr(session_factory=lambda key: called.append(key)))
        assert result.asr_online is False
        assert called == []


# ── 用量聚合（ASR 单独成列，TTS 预算口径不变） ──


class TestUsageAggregation:
    def _user(self, db):
        from tests.conftest import make_user

        return make_user(db, personas=())

    def _seed(self, db, *, user_id, direction, cost, status="success", chars=0):
        db.add(
            VoiceCallLog(
                user_id=user_id,
                direction=direction,
                text_length=chars,
                latency_ms=10,
                status=status,
                cost_estimated=cost,
                created_at=datetime.now(UTC),
            )
        )

    def test_asr_today_and_month_aggregate(self, pg_session):
        user = self._user(pg_session)
        self._seed(pg_session, user_id=user.id, direction="tts", cost=0.5, chars=100)
        self._seed(pg_session, user_id=user.id, direction="asr", cost=0.25, status="success")
        self._seed(pg_session, user_id=user.id, direction="asr", cost=0.75, status="error")
        pg_session.flush()

        usage = CostService(pg_session, platform_scope()).get_usage()

        assert isinstance(usage, VoiceUsageResponse)
        assert usage.tts_today.calls_total == 1
        assert usage.asr_today.calls_total == 2
        assert usage.asr_today.calls_success == 1
        assert usage.asr_today.calls_error == 1
        assert usage.asr_today.cost_estimated == pytest.approx(1.0)
        assert usage.asr_month.cost_estimated == pytest.approx(1.0)

    def test_monthly_used_counts_only_tts(self, pg_session):
        user = self._user(pg_session)
        self._seed(pg_session, user_id=user.id, direction="tts", cost=2.0, chars=10)
        self._seed(pg_session, user_id=user.id, direction="asr", cost=5.0)
        pg_session.flush()

        usage = CostService(pg_session, platform_scope()).get_usage()

        assert usage.monthly_used == pytest.approx(2.0)
        assert usage.tts_month.cost_estimated == pytest.approx(2.0)
        assert usage.asr_month.cost_estimated == pytest.approx(5.0)

    def test_asr_absent_is_zeroed_not_missing(self, pg_session):
        user = self._user(pg_session)
        self._seed(pg_session, user_id=user.id, direction="tts", cost=1.0, chars=5)
        pg_session.flush()
        usage = CostService(pg_session, platform_scope()).get_usage()
        assert usage.asr_today.calls_total == 0
        assert usage.asr_month.cost_estimated == 0.0

    def test_daily_series_includes_asr_cost(self, pg_session):
        user = self._user(pg_session)
        self._seed(pg_session, user_id=user.id, direction="tts", cost=1.0, chars=5)
        self._seed(pg_session, user_id=user.id, direction="asr", cost=3.0)
        pg_session.flush()

        series = CostService(pg_session, platform_scope())._daily_series(3)
        today = series[-1]
        assert today.date == datetime.now(UTC).strftime("%Y-%m-%d")
        # 曲线口径 = 语音总成本（tts + asr），ASR 不能从趋势里消失
        assert today.tts_cost == pytest.approx(4.0)


# ── 迁移内容 ──

_MIGRATION = Path(__file__).resolve().parents[2] / "migrations" / "versions" / "ddl"


def _load_migration(path: Path):
    spec = importlib.util.spec_from_file_location(f"ddl_{path.stem}", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class TestMigration:
    @pytest.fixture(scope="class")
    def migration(self):
        path = _MIGRATION / "b7e3c5a9d1f8_add_asr_api_key_to_voice_configs.py"
        assert path.exists(), "缺少 ASR 独立凭据迁移"
        return _load_migration(path)

    def test_revision_chain(self, migration):
        assert migration.revision == "b7e3c5a9d1f8"
        assert migration.down_revision == "a6f1c3d9e2b4"

    def test_is_single_current_head(self, migration):
        """新迁移必须挂成唯一 head：没有任何迁移的 down_revision 指向它。"""
        down_revisions = {
            getattr(_load_migration(f), "down_revision", None)
            for f in _MIGRATION.glob("*.py")
            if f.name not in ("__init__.py", "b7e3c5a9d1f8_add_asr_api_key_to_voice_configs.py")
        }
        assert migration.revision not in down_revisions

    def test_column_matches_model(self):
        col = Base.metadata.tables["voice_configs"].c["asr_api_key"]
        assert col.nullable is False
        assert col.type.python_type is str

    def test_both_directions_and_column_name(self, migration):
        import inspect

        upgrade_src = inspect.getsource(migration.upgrade)
        downgrade_src = inspect.getsource(migration.downgrade)
        assert "asr_api_key" in upgrade_src
        assert "add_column" in upgrade_src
        assert "asr_api_key" in downgrade_src
        assert "drop_column" in downgrade_src
