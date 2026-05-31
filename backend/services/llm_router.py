"""LLM API 路由调度器 —— 基于 priority + weight 的 key 选择与熔断"""
import asyncio
import logging
import random
import threading
from datetime import datetime, timezone, timedelta

_logger = logging.getLogger("nursing")

CIRCUIT_BREAKER_THRESHOLD = 5
RATE_LIMIT_COOLDOWN_SECONDS = 60
GLOBAL_DEGRADED_TTL_SECONDS = 30


class LLMRouter:
    def __init__(self):
        self._cache: dict | None = None
        self._last_valid_cache: dict | None = None
        self._global_degraded: tuple[bool, datetime | None] = (False, None)
        self._lock = asyncio.Lock()
        self._state_lock = threading.Lock()

    def _load_config(self, config: dict):
        """直接设置缓存（测试用 + 内部加载用）"""
        self._cache = config
        self._global_degraded = (False, None)

    async def load_from_db(self):
        """从数据库加载配置到内存"""
        from database import SessionLocal
        from models import ApiProvider, ApiKey

        db = SessionLocal()
        try:
            providers = db.query(ApiProvider).filter(ApiProvider.is_enabled == True).all()
            config = {}
            for p in providers:
                keys = db.query(ApiKey).filter(
                    ApiKey.provider_id == p.id,
                    ApiKey.status.in_(["active", "rate_limited"]),
                ).all()
                config[p.id] = {"provider": p, "keys": keys}
            total_active = sum(1 for c in config.values() for k in c["keys"] if k.status == "active")
            if total_active == 0:
                if self._last_valid_cache:
                    _logger.error("加载配置失败：无可用 API key，保留上次缓存")
                    return
                raise RuntimeError("无可用 API key，无法启动 LLMRouter")
            async with self._lock:
                self._last_valid_cache = self._cache
                self._cache = config
                self._global_degraded = (False, None)
            _logger.info("LLMRouter 配置加载: %d providers, %d keys",
                         len(config), sum(len(c["keys"]) for c in config.values()))
        except Exception:
            _logger.exception("LLMRouter 配置加载失败")
            if self._last_valid_cache:
                async with self._lock:
                    self._cache = self._last_valid_cache
                _logger.warning("保留上次有效配置")
            raise
        finally:
            db.close()

    def _get_key(self, key_id: int):
        if self._cache is None:
            return None
        for pd in self._cache.values():
            for k in pd["keys"]:
                if k.id == key_id:
                    return k
        return None

    def select_key(self, purpose: str):
        if self._cache is None:
            raise RuntimeError("LLMRouter 未初始化")

        with self._state_lock:
            degraded, degraded_at = self._global_degraded
            if degraded and degraded_at and degraded_at > datetime.now(timezone.utc):
                raise RuntimeError("所有 API provider 不可用，全局降级中")

            # 收集所有匹配的 provider 组，按 provider.priority 升序排序
            provider_groups = []
            for pd in self._cache.values():
                provider = pd["provider"]
                group_keys = []
                for key in pd["keys"]:
                    if key.status == "disabled":
                        continue
                    if key.status == "rate_limited":
                        if key.rate_limit_until is None or key.rate_limit_until > datetime.now(timezone.utc):
                            continue
                        key.status = "active"
                        key.rate_limit_until = None
                    if key.consecutive_failures >= CIRCUIT_BREAKER_THRESHOLD:
                        continue
                    if key.purpose != purpose and key.purpose != "*":
                        continue
                    group_keys.append((key, provider))
                if group_keys:
                    provider_groups.append((provider.priority, group_keys))

            if not provider_groups:
                self._global_degraded = (
                    True,
                    datetime.now(timezone.utc) + timedelta(seconds=GLOBAL_DEGRADED_TTL_SECONDS)
                )
                raise RuntimeError("无可用 API key")

            # 按 provider.priority 升序尝试
            provider_groups.sort(key=lambda g: g[0])

            for _, group in provider_groups:
                exact = [k for k in group if k[0].purpose == purpose]
                wild = [k for k in group if k[0].purpose == "*"]
                candidates = exact if exact else wild
                total_weight = sum(k[0].weight for k in candidates)
                if total_weight <= 0:
                    continue
                r = random.uniform(0, total_weight)
                cumulative = 0
                for key, provider in candidates:
                    cumulative += key.weight
                    if r <= cumulative:
                        key.last_used_at = datetime.now(timezone.utc)
                        return key, provider

            self._global_degraded = (
                True,
                datetime.now(timezone.utc) + timedelta(seconds=GLOBAL_DEGRADED_TTL_SECONDS)
            )
            raise RuntimeError("无可用 API key")

    def get_decrypted_key(self, key_id: int) -> str:
        from services.crypto_utils import decrypt_api_key
        key = self._get_key(key_id)
        if key is None:
            raise ValueError(f"API key {key_id} not found")
        return decrypt_api_key(key.encrypted_key)

    def report_result(self, key_id: int, *, success: bool, tokens: int,
                      latency_ms: int, error: str | None):
        with self._state_lock:
            key = self._get_key(key_id)
            if key is None:
                return
            if success:
                key.consecutive_failures = 0
                if key.status == "rate_limited":
                    key.status = "active"
                    key.rate_limit_until = None
                self._update_stats(key, tokens)
            else:
                if error and "429" in error:
                    key.status = "rate_limited"
                    key.rate_limit_until = datetime.now(timezone.utc) + timedelta(seconds=RATE_LIMIT_COOLDOWN_SECONDS)
                else:
                    key.consecutive_failures += 1
                    if key.consecutive_failures >= CIRCUIT_BREAKER_THRESHOLD:
                        key.status = "disabled"
                        _logger.warning("API key %d 熔断（连续%d次失败）", key_id, CIRCUIT_BREAKER_THRESHOLD)

    def _update_stats(self, key, tokens: int):
        today = datetime.now(timezone.utc).date()
        month = today.strftime("%Y-%m")
        stats_date = getattr(key, 'stats_date', None)
        if stats_date is None or stats_date < today:
            key.call_count_today = 0
            key.total_tokens_today = 0
            key.total_cost_today = float(0)
            key.stats_date = today
        stats_month = getattr(key, 'stats_month', None)
        if stats_month is None or stats_month < month:
            key.monthly_cost_used = float(0)
            key.stats_month = month
        key.call_count_today = (key.call_count_today or 0) + 1
        key.total_tokens_today = (key.total_tokens_today or 0) + tokens
        avg_price = (float(getattr(key, 'price_input_per_1m', 0) or 0) + float(getattr(key, 'price_output_per_1m', 0) or 0)) / 2
        cost = avg_price * tokens / 1_000_000
        key.total_cost_today = float(key.total_cost_today or 0) + cost
        key.monthly_cost_used = float(key.monthly_cost_used or 0) + cost


_router: LLMRouter | None = None
_router_lock = asyncio.Lock()


async def get_router() -> LLMRouter:
    global _router
    if _router is not None:
        return _router
    async with _router_lock:
        if _router is None:
            _router = LLMRouter()
            await _router.load_from_db()
    return _router


async def refresh_router():
    global _router
    if _router is None:
        _router = LLMRouter()
    await _router.load_from_db()
