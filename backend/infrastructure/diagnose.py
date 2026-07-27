"""
诊断服务 —— 应用内错误日志收集 + 诊断数据快照

- ErrorCaptureHandler: 挂在 Python logging 上，实时捕获 ERROR+ 级别日志到内存环缓冲
- DiagnoseService: 聚合服务诊断数据（服务器、DB、LLM、错误日志），带 TTL 缓存
"""

import logging
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime

from core.config import APP_VERSION

log = logging.getLogger(__name__)

# ── 常量 ───────────────────────────────────────────────────────────────────────

_MAX_ERRORS = 2000  # 内存环缓冲最大错误条数
_CACHE_TTL = 120  # 诊断快照缓存秒数
_RECENT_ERRORS_N = 20  # 返回的最新错误数
_DEDUP_WINDOW = 300  # 去重窗口秒数（5 分钟内相同 logger+message 合并）
_DEDUP_HASH_HEAD = 200  # 去重 hash 的消息取前 N 字符
_MSG_MAX = 4000  # 单条错误消息最大字符数
_MSG_HEAD = 1200  # 截断时保留的头部字符数（含日志上下文）
_PROCESS_START = time.time()  # 进程启动时间戳


def _truncate_message(msg: str) -> str:
    """截断超长错误消息，但保留尾部——traceback 的根因行在末尾。"""
    if len(msg) <= _MSG_MAX:
        return msg
    tail = _MSG_MAX - _MSG_HEAD - len("\n...[truncated]...\n")
    return f"{msg[:_MSG_HEAD]}\n...[truncated]...\n{msg[-tail:]}"


# ── 错误日志收集器 ──────────────────────────────────────────────────────────────


@dataclass
class ErrorEntry:
    """单条错误日志"""

    level: str
    logger: str
    message: str
    time: str  # ISO format
    timestamp: float  # unix seconds


class ErrorCaptureHandler(logging.Handler):
    """日志处理器：将 ERROR+ 级别日志缓存到内存环缓冲，带去重合并。"""

    def __init__(self, max_errors: int = _MAX_ERRORS):
        super().__init__(level=logging.ERROR)
        self.buffer: deque[ErrorEntry] = deque(maxlen=max_errors)
        self._dedup: dict[tuple[str, str], tuple[float, int]] = {}
        self.setFormatter(logging.Formatter("%(asctime)s.%(msecs)03d %(levelname)-8s %(name)s %(message)s"))

    def _dedup_key(self, logger: str, message: str) -> tuple[str, str]:
        return (logger, message[:_DEDUP_HASH_HEAD])

    def _prune_dedup(self, now: float) -> None:
        stale = [k for k, (ts, _) in self._dedup.items() if now - ts > _DEDUP_WINDOW]
        for k in stale:
            del self._dedup[k]

    def emit(self, record: logging.LogRecord):
        try:
            msg = self.format(record)
        except Exception:
            msg = record.getMessage()
        ts = time.time()
        key = self._dedup_key(record.name, msg)
        self._prune_dedup(ts)
        if key in self._dedup:
            _, count = self._dedup[key]
            self._dedup[key] = (ts, count + 1)
            return
        self._dedup[key] = (ts, 1)
        self.buffer.append(
            ErrorEntry(
                level=record.levelname,
                logger=record.name,
                message=_truncate_message(msg),
                time=datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
                timestamp=record.created,
            )
        )

    def get_recent(self, n: int = _RECENT_ERRORS_N) -> list[dict]:
        """返回最近的 N 条错误（不含时间戳字段）"""
        entries = list(self.buffer)[-n:]
        return [_strip_diagnose_entry(e) for e in entries]

    @property
    def error_count_last_hour(self) -> int:
        """过去 1 小时内的错误数（含去重计数）"""
        cutoff = time.time() - 3600
        return sum(1 for e in self.buffer if e.timestamp >= cutoff)

    @property
    def error_count_last_5min(self) -> int:
        """过去 5 分钟内的错误数（含去重计数）"""
        cutoff = time.time() - 300
        return sum(1 for e in self.buffer if e.timestamp >= cutoff)

    @property
    def unique_error_count_24h(self) -> int:
        """过去 24 小时内不重复错误类型数"""
        cutoff = time.time() - 86400
        return len({(e.logger, e.message[:_DEDUP_HASH_HEAD]) for e in self.buffer if e.timestamp >= cutoff})

    @property
    def error_burst_5min(self) -> int:
        """过去 5 分钟错误突增计数（用于短窗口告警）"""
        return self.error_count_last_5min


def _strip_diagnose_entry(e: ErrorEntry) -> dict:
    return {"time": e.time, "level": e.level, "logger": e.logger, "message": e.message}


# ── 诊断服务 ───────────────────────────────────────────────────────────────────


@dataclass
class DiagnoseSnapshot:
    """一次性诊断快照"""

    server: dict = field(
        default_factory=lambda: {
            "version": APP_VERSION,
            "uptime_seconds": int(time.time() - _PROCESS_START),
        }
    )
    database: dict | None = None
    llm: dict | None = None
    errors: dict | None = None
    active_sessions: int = 0
    cached_at: str = ""


class DiagnoseService:
    """诊断数据聚合服务，带 TTL 缓存"""

    def __init__(self):
        self._handler: ErrorCaptureHandler | None = None
        self._cache: dict | None = None
        self._cache_time: float = 0
        self._app_ref = None

    def install_handler(self):
        """将 ErrorCaptureHandler 挂到 root logger"""
        if self._handler is not None:
            return
        self._handler = ErrorCaptureHandler()
        logging.root.addHandler(self._handler)
        log.info("ErrorCaptureHandler installed on root logger")

    def set_app(self, app):
        """保存 FastAPI 引用，用于读取 llm_router / metrics 等状态"""
        self._app_ref = app

    @property
    def _active_sessions(self) -> int:
        if self._app_ref is None:
            return 0
        try:
            metrics = getattr(self._app_ref.state, "metrics", None)
            if metrics:
                snap = metrics.snapshot()
                return snap.get("active_sessions", 0)
        except Exception:
            log.warning("Metrics snapshot _active_sessions failed", exc_info=True)
        return 0

    async def _db_status(self) -> dict:
        import asyncio

        def _check():
            try:
                from sqlalchemy import text

                from core.database import engine

                pool = getattr(engine, "pool", None)
                info: dict = {"connected": False, "pool_size": 0, "checked_out": 0}
                if pool:
                    pool_size = getattr(pool, "size", 0)
                    if callable(pool_size):
                        pool_size = pool_size()
                    checked_out = getattr(pool, "checkedin", 0)
                    if callable(checked_out):
                        checked_out = checked_out()
                    info["pool_size"] = pool_size
                    info["checked_out"] = checked_out
                with engine.connect() as conn:
                    conn.execute(text("SELECT 1"))
                info["connected"] = True
                return info
            except Exception as e:
                return {"connected": False, "error": str(e)[:200]}

        return await asyncio.to_thread(_check)

    @property
    def _llm_status(self) -> dict:
        if self._app_ref is None:
            return {"status": "unknown"}
        try:
            router = getattr(self._app_ref.state, "llm_router", None)
            if router is None:
                return {"status": "not_loaded"}
            return {
                "degraded_providers": router.degraded_count() if hasattr(router, "degraded_count") else 0,
                "global_degraded": router.global_degraded if hasattr(router, "global_degraded") else False,
            }
        except Exception as e:
            return {"status": "error", "detail": str(e)[:200]}

    async def build_snapshot(self) -> dict:
        """构建一次完整的诊断快照（不走缓存）"""
        now_iso = datetime.now(UTC).isoformat()
        err = None
        if self._handler:
            err = {
                "last_5min": self._handler.error_count_last_5min,
                "last_hour": self._handler.error_count_last_hour,
                "total_captured": len(self._handler.buffer),
                "unique_24h": self._handler.unique_error_count_24h,
                "burst_5min": self._handler.error_burst_5min,
                "recent": self._handler.get_recent(_RECENT_ERRORS_N),
            }
        else:
            err = {"last_5min": 0, "last_hour": 0, "total_captured": 0, "unique_24h": 0, "burst_5min": 0, "recent": []}

        fe_buffer = getattr(self._app_ref.state, "frontend_error_buffer", None) if self._app_ref else None
        frontend_errors = (
            fe_buffer.snapshot() if fe_buffer else {"last_5min": 0, "last_hour": 0, "total_captured": 0, "recent": []}
        )

        ss = DiagnoseSnapshot(
            database=await self._db_status(),
            llm=self._llm_status,
            errors=err,
            active_sessions=self._active_sessions,
            cached_at=now_iso,
        )
        return {
            "server": ss.server,
            "database": ss.database,
            "llm": ss.llm,
            "errors": ss.errors,
            "frontend_errors": frontend_errors,
            "active_sessions": ss.active_sessions,
            "cached_at": ss.cached_at,
        }

    async def get_diagnose(self) -> dict:
        """获取诊断数据（带 TTL 缓存）"""
        now = time.time()
        if self._cache and (now - self._cache_time) < _CACHE_TTL:
            return self._cache
        self._cache = await self.build_snapshot()
        self._cache_time = now
        return self._cache


# ── 单例 ──────────────────────────────────────────────────────────────────────

_service: DiagnoseService | None = None


def get_diagnose_service() -> DiagnoseService:
    global _service
    if _service is None:
        _service = DiagnoseService()
    return _service
