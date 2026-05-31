import os
from pathlib import Path
from urllib.parse import urlparse

try:
    from dotenv import load_dotenv
    env_path = Path(__file__).resolve().parent.parent / ".env"
    load_dotenv(env_path)
except ImportError:
    pass

ENV = os.getenv("ENV", "development")
APP_VERSION = os.getenv("APP_VERSION", "dev")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/vptest")

_raw_secret = os.getenv("SECRET_KEY", "")
_SECRET_PLACEHOLDERS = {"", "change-me-to-a-random-secret-key", "virtual-patient-secret-key-change-in-production"}
if _raw_secret in _SECRET_PLACEHOLDERS:
    raise RuntimeError(
        "SECRET_KEY 未配置或仍为默认值。请在项目根目录的 .env 文件中设置一个随机字符串作为 SECRET_KEY。\n"
        "例如: SECRET_KEY=aB3xK9mW7qR2tY6v\n"
        "可使用 python -c \"import secrets; print(secrets.token_urlsafe(32))\" 生成安全密钥。"
    )
SECRET_KEY = _raw_secret
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))

# LLM 成本估算
LLM_PRICE_INPUT_PER_1M = float(os.getenv("LLM_PRICE_INPUT_PER_1M", "0"))
LLM_PRICE_OUTPUT_PER_1M = float(os.getenv("LLM_PRICE_OUTPUT_PER_1M", "0"))
LLM_COST_CURRENCY = os.getenv("LLM_COST_CURRENCY", "CNY")

# [deprecated] 仅用于 seed 初始数据，API 管理已迁移到数据库（LLMRouter）
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

# LLM 调用参数
LLM_MAX_RETRIES = int(os.getenv("LLM_MAX_RETRIES", "3"))
LLM_REQUEST_TIMEOUT = int(os.getenv("LLM_REQUEST_TIMEOUT", "90"))
LLM_CONCURRENT_LIMIT = int(os.getenv("LLM_CONCURRENT_LIMIT", "10"))
LLM_CONNECTION_POOL_SIZE = int(os.getenv("LLM_CONNECTION_POOL_SIZE", "20"))
LLM_CONNECTION_KEEPALIVE = int(os.getenv("LLM_CONNECTION_KEEPALIVE", "10"))

# 聊天和评分使用不同的超时和 token 限制
LLM_CHAT_TIMEOUT = int(os.getenv("LLM_CHAT_TIMEOUT", "30"))
LLM_CHAT_MAX_TOKENS = int(os.getenv("LLM_CHAT_MAX_TOKENS", "512"))
LLM_SCORING_TIMEOUT = int(os.getenv("LLM_SCORING_TIMEOUT", "120"))
LLM_SCORING_MAX_TOKENS = int(os.getenv("LLM_SCORING_MAX_TOKENS", "2048"))


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
