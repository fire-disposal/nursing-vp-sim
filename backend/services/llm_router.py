"""LLM 路由调度器 —— 基于 LLMConfig priority 降级 + 熔断自动恢复"""
import asyncio
import logging
from datetime import datetime, timezone, timedelta

_logger = logging.getLogger("nursing")

CIRCUIT_BREAKER_THRESHOLD = 5
RATE_LIMIT_COOLDOWN_SECONDS = 60
DEGRADED_TTL_SECONDS = 300
GLOBAL_DEGRADED_TTL_SECONDS = 30


class _SyntheticConfig:
    """应急硬编码配置 —— 当 DB 无 LLMConfig 时，直接用 .env 的 DEEPSEEK_API_KEY 兜底"""
    def __init__(self, label="", base_url="", model="", raw_key=""):
        self.id = 0
        self.label = label
        self.base_url = base_url
        self.model = model
        self._raw_key = raw_key
        self.purpose = "*"
        self.priority = 999
        self.status = "active"
        self.consecutive_failures = 0
        self.degraded_reason = None
        self.degraded_until = None
        self.price_input_per_1m = 1.0
        self.price_output_per_1m = 2.0
        self.monthly_cost_limit = 0.0
        self.call_count_today = 0
        self.total_tokens_today = 0
        self.total_cost_today = 0.0
        self.monthly_cost_used = 0.0
        self.stats_date = None
        self.stats_month = None
        self.last_used_at = None


class ConfigRouter:
    def __init__(self):
        self._cache: list | None = None
        self._cache_by_purpose: dict[str, list] = {}
        self._global_degraded_until: datetime | None = None
        self._state_lock = asyncio.Lock()

    async def load_from_db(self):
        from database import SessionLocal
        from models import LLMConfig as LC

        db = SessionLocal()
        try:
            now = datetime.now(timezone.utc)
            rows = db.query(LC).order_by(LC.purpose, LC.priority).all()

            recovered = 0
            for r in rows:
                if r.status == "degraded" and r.degraded_until and r.degraded_until <= now:
                    r.status = "active"
                    r.degraded_reason = None
                    r.degraded_until = None
                    r.consecutive_failures = 0
                    recovered += 1
            if recovered:
                db.commit()

            by_purpose: dict[str, list] = {}
            for r in rows:
                by_purpose.setdefault(r.purpose, []).append(r)

            async with self._state_lock:
                self._cache = rows
                self._cache_by_purpose = by_purpose
                self._global_degraded_until = None

            _logger.info("ConfigRouter loaded: %d configs across %d purposes",
                         len(rows), len(by_purpose))
        except Exception:
            _logger.exception("ConfigRouter load failed")
            raise
        finally:
            db.close()

    def select_key(self, purpose: str):
        configs = self._cache_by_purpose.get(purpose, [])

        if not configs and purpose != "*":
            configs = self._cache_by_purpose.get("*", [])

        if self._global_degraded_until and datetime.now(timezone.utc) < self._global_degraded_until:
            raise RuntimeError("所有配置不可用，全局降级中")

        for cfg in configs:
            if cfg.status == "disabled":
                continue
            if cfg.status == "degraded":
                if cfg.degraded_until and datetime.now(timezone.utc) < cfg.degraded_until:
                    continue
                cfg.status = "active"
                cfg.degraded_reason = None
                cfg.degraded_until = None
                cfg.consecutive_failures = 0

            return cfg

        # ── 应急硬编码兜底：DB 无配置时直接用 .env 中的 DEEPSEEK_API_KEY ──
        from config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, DEEPSEEK_MODEL_PRO
        if DEEPSEEK_API_KEY and DEEPSEEK_API_KEY.startswith("sk-"):
            _logger.warning("LLMRouter: 无DB可用配置，使用 .env DEEPSEEK 密钥应急兜底 (purpose=%s)", purpose)
            if purpose == "scoring":
                return _SyntheticConfig(
                    label="DeepSeek Pro (env-fallback)",
                    base_url=DEEPSEEK_BASE_URL, model=DEEPSEEK_MODEL_PRO,
                    raw_key=DEEPSEEK_API_KEY,
                )
            else:
                return _SyntheticConfig(
                    label="DeepSeek Flash (env-fallback)",
                    base_url=DEEPSEEK_BASE_URL, model=DEEPSEEK_MODEL,
                    raw_key=DEEPSEEK_API_KEY,
                )

        self._global_degraded_until = datetime.now(timezone.utc) + timedelta(seconds=GLOBAL_DEGRADED_TTL_SECONDS)
        raise RuntimeError(f"purpose={purpose} 无可用配置")

    def get_decrypted_key(self, config) -> str:
        if isinstance(config, _SyntheticConfig):
            return config._raw_key
        from services.crypto_utils import decrypt_api_key
        return decrypt_api_key(config.secret.encrypted_key)

    def report_result(self, config, *, success: bool, tokens: int,
                      latency_ms: int, error: str | None):
        now = datetime.now(timezone.utc)
        degraded = False

        if success:
            config.consecutive_failures = 0
            if config.status == "degraded":
                config.status = "active"
                config.degraded_reason = None
                config.degraded_until = None
                degraded = True
            self._update_stats(config, tokens)
        else:
            if error and "429" in error:
                config.status = "degraded"
                config.degraded_reason = "rate_limited"
                config.degraded_until = now + timedelta(seconds=RATE_LIMIT_COOLDOWN_SECONDS)
                degraded = True
                _logger.warning("LLMConfig %d rate limited, degraded for %ds",
                               config.id, RATE_LIMIT_COOLDOWN_SECONDS)
            else:
                config.consecutive_failures += 1
                if config.consecutive_failures >= CIRCUIT_BREAKER_THRESHOLD:
                    config.status = "degraded"
                    config.degraded_reason = "consecutive_failures"
                    config.degraded_until = now + timedelta(seconds=DEGRADED_TTL_SECONDS)
                    degraded = True
                    _logger.warning("LLMConfig %d circuit broken: %d failures, degraded %ds",
                                   config.id, CIRCUIT_BREAKER_THRESHOLD, DEGRADED_TTL_SECONDS)

        if degraded:
            self._persist_config_stats(config)

    def _update_stats(self, config, tokens: int):
        today = datetime.now(timezone.utc).date()
        month = today.strftime("%Y-%m")

        if config.stats_date is None or config.stats_date < today:
            config.call_count_today = 0
            config.total_tokens_today = 0
            config.total_cost_today = float(0)
            config.stats_date = today
        if config.stats_month is None or config.stats_month < month:
            config.monthly_cost_used = float(0)
            config.stats_month = month

        config.call_count_today = (config.call_count_today or 0) + 1
        config.total_tokens_today = (config.total_tokens_today or 0) + tokens
        avg_price = (float(config.price_input_per_1m or 0) + float(config.price_output_per_1m or 0)) / 2
        cost = avg_price * tokens / 1_000_000
        config.total_cost_today = float(config.total_cost_today or 0) + cost
        config.monthly_cost_used = float(config.monthly_cost_used or 0) + cost
        config.last_used_at = datetime.now(timezone.utc)

        limit = float(config.monthly_cost_limit or 0)
        if limit > 0 and float(config.monthly_cost_used) >= limit:
            config.status = "degraded"
            config.degraded_reason = "cost_exceeded"
            if config.degraded_until is None:
                now = datetime.now(timezone.utc)
                next_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
                if now.month == 12:
                    next_month = next_month.replace(year=now.year + 1, month=1)
                else:
                    next_month = next_month.replace(month=now.month + 1)
                config.degraded_until = next_month

        if config.call_count_today % 5 == 0:
            self._persist_config_stats(config)

    @staticmethod
    def _persist_config_stats(config):
        from database import SessionLocal
        from models import LLMConfig as LC
        db = SessionLocal()
        try:
            db_cfg = db.query(LC).filter(LC.id == config.id).first()
            if db_cfg:
                db_cfg.call_count_today = config.call_count_today
                db_cfg.total_tokens_today = config.total_tokens_today
                db_cfg.total_cost_today = float(config.total_cost_today or 0)
                db_cfg.monthly_cost_used = float(config.monthly_cost_used or 0)
                db_cfg.stats_date = config.stats_date
                db_cfg.stats_month = config.stats_month
                db_cfg.last_used_at = config.last_used_at
                db_cfg.status = config.status
                db_cfg.degraded_reason = config.degraded_reason
                db_cfg.degraded_until = config.degraded_until
                db_cfg.consecutive_failures = config.consecutive_failures
                db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()


_router: ConfigRouter | None = None
_router_lock = asyncio.Lock()


async def get_router() -> ConfigRouter:
    global _router
    if _router is not None:
        return _router
    async with _router_lock:
        if _router is None:
            _router = ConfigRouter()
            await _router.load_from_db()
    return _router


async def refresh_router():
    global _router
    if _router is None:
        _router = ConfigRouter()
    await _router.load_from_db()
