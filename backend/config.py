import logging
import os
from pathlib import Path
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

try:
    from dotenv import load_dotenv

    env_path = Path(__file__).resolve().parent.parent / ".env"
    load_dotenv(env_path)
except ImportError:
    logger.warning("python-dotenv 未安装，使用系统环境变量")

ENV = os.getenv("ENV", "development")
APP_VERSION = os.getenv("APP_VERSION", "dev")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/vptest")

_raw_secret = os.getenv("SECRET_KEY", "")
_SECRET_MIN_LENGTH = 32
_SECRET_PLACEHOLDERS = {
    "",
    "change-me-to-a-random-secret-key",
    "virtual-patient-secret-key-change-in-production",
    "test-secret-key-for-dev-only",
}
if _raw_secret in _SECRET_PLACEHOLDERS:
    raise RuntimeError(
        "SECRET_KEY 未配置或仍为默认值。请在项目根目录的 .env 文件中设置一个随机字符串作为 SECRET_KEY。\n"
        '可使用 python -c "import secrets; print(secrets.token_urlsafe(32))" 生成安全密钥。'
    )
if len(_raw_secret) < _SECRET_MIN_LENGTH:
    raise RuntimeError(
        f"SECRET_KEY 长度不足（当前 {len(_raw_secret)} 字符，要求至少 {_SECRET_MIN_LENGTH} 字符）。\n"
        "过短的密钥会导致 JWT 签名可被暴力破解。\n"
        '可使用 python -c "import secrets; print(secrets.token_urlsafe(32))" 生成安全密钥。'
    )
SECRET_KEY = _raw_secret
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))

# LLM 成本估算（全局回退值，优先使用数据库中每 key 定价）
LLM_PRICE_INPUT_PER_1M = float(os.getenv("LLM_PRICE_INPUT_PER_1M", "1"))
LLM_PRICE_OUTPUT_PER_1M = float(os.getenv("LLM_PRICE_OUTPUT_PER_1M", "2"))
LLM_COST_CURRENCY = os.getenv("LLM_COST_CURRENCY", "CNY")

# DeepSeek 种子数据（首次启动用，之后通过管理面板管理）
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")
DEEPSEEK_MODEL_PRO = os.getenv("DEEPSEEK_MODEL_PRO", "deepseek-v4-pro")

# 微信小程序
WECHAT_APPID = os.getenv("WECHAT_APPID", "")
WECHAT_SECRET = os.getenv("WECHAT_SECRET", "")

# LLM 调用参数
LLM_MAX_RETRIES = int(os.getenv("LLM_MAX_RETRIES", "3"))  # 单次调用最大重试次数
LLM_REQUEST_TIMEOUT = int(os.getenv("LLM_REQUEST_TIMEOUT", "90"))  # 单次 HTTP 请求超时（秒）
LLM_CONCURRENT_LIMIT = int(os.getenv("LLM_CONCURRENT_LIMIT", "50"))  # 全局并发 LLM 调用数上限
LLM_CONNECTION_POOL_SIZE = int(os.getenv("LLM_CONNECTION_POOL_SIZE", "60"))  # HTTP 连接池大小
LLM_CONNECTION_KEEPALIVE = int(os.getenv("LLM_CONNECTION_KEEPALIVE", "30"))  # 空闲连接存活时间（秒）

# LLM 调用参数 —— 按 purpose 集中管理，支持 JSON 环境变量覆盖
_LLM_PURPOSE_DEFAULTS: dict[str, dict] = {
    "patient_chat": {"timeout": 30, "max_tokens": 512, "temperature": 0.6, "max_retries": 2},
    "qa": {"timeout": 30, "max_tokens": 1024, "temperature": 0.7, "max_retries": 2},
    "scoring": {"timeout": 120, "max_tokens": 4096, "temperature": 0, "max_retries": 3},
    "case_generation": {"timeout": 120, "max_tokens": 4096, "temperature": 0.3, "max_retries": 3},
}


def get_llm_config(purpose: str) -> dict:
    """返回某 purpose 的 LLM 调用参数。环境变量 LLM_CONFIG_JSON 可覆盖。"""
    import json as _json
    import os as _os

    override = _os.getenv("LLM_CONFIG_JSON")
    if override:
        try:
            overrides = _json.loads(override)
            if purpose in overrides:
                return overrides[purpose]
        except _json.JSONDecodeError:
            pass
    return _LLM_PURPOSE_DEFAULTS.get(purpose, _LLM_PURPOSE_DEFAULTS["patient_chat"])


def log_config(logger):
    """输出脱敏后的关键配置（启动时调用）"""
    db = urlparse(DATABASE_URL)
    db_safe = f"{db.scheme}://{db.username}:***@{db.hostname}:{db.port}{db.path}"

    secret_tail = SECRET_KEY[-4:] if len(SECRET_KEY) >= 4 else "****"
    api_tail = DEEPSEEK_API_KEY[-4:] if len(DEEPSEEK_API_KEY) >= 4 else "****"

    logger.info("── 环境配置 ──────────────────────────")
    logger.info("  环境:       %s", ENV)
    logger.info("  版本:       %s", APP_VERSION)
    logger.info("  数据库:     %s", db_safe)
    logger.info("  CORS:       %s", os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:8000"))
    logger.info("  SECRET_KEY: ***%s (%d 位)", secret_tail, len(SECRET_KEY))
    logger.info("  DeepSeek:   %s (model=%s, key=***%s)", DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, api_tail)
    logger.info("  JWT 过期:   %d 分钟", ACCESS_TOKEN_EXPIRE_MINUTES)
    logger.info("  LLM 并发:   %d (重试=%d, 超时=%ds)", LLM_CONCURRENT_LIMIT, LLM_MAX_RETRIES, LLM_REQUEST_TIMEOUT)
    logger.info("──────────────────────────────────────")
