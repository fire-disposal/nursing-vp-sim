import json as _json
import logging
import os
from pathlib import Path
from urllib.parse import urlparse

log = logging.getLogger(__name__)

try:
    from dotenv import load_dotenv

    env_path = Path(__file__).resolve().parent.parent.parent / ".env"
    load_dotenv(env_path)
except ImportError:
    log.warning("python-dotenv 未安装，使用系统环境变量")

ENV = os.getenv("ENV", "development")
APP_VERSION = os.getenv("APP_VERSION", "dev")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/vptest")

_raw_secret = os.getenv("SECRET_KEY", "")
SECRET_KEY = _raw_secret
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))


def validate_config():
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

    db = urlparse(DATABASE_URL)
    if not db.scheme or not db.hostname:
        raise RuntimeError(
            f"DATABASE_URL 格式无效: {DATABASE_URL}\n应为 postgresql://user:password@host:port/dbname 格式。"
        )
    if db.scheme not in ("postgresql", "postgresql+psycopg"):
        raise RuntimeError(f"DATABASE_URL scheme 无效: {db.scheme}（期望 postgresql 或 postgresql+psycopg）")

    cors_raw = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:8000")
    if not cors_raw or not any(o.strip() for o in cors_raw.split(",")):
        log.warning("CORS_ORIGINS 未配置或为空，跨域请求将全部被拒绝")
    origins = [o.strip() for o in cors_raw.split(",") if o.strip()]
    if "*" in origins:
        log.warning("CORS_ORIGINS 包含通配符 *, 这可能会导致安全问题")

    if not DEEPSEEK_API_KEY:
        raise RuntimeError(
            "DEEPSEEK_API_KEY 未配置。请在 .env 中设置 DeepSeek API 密钥。\n"
            "如不需要 LLM 功能，请设置 DEEPSEEK_API_KEY=skip 以跳过验证。"
        )
    if DEEPSEEK_API_KEY == "skip":
        log.warning("DEEPSEEK_API_KEY=skip — LLM 调用将全部失败，仅用于纯前端开发")
    elif not DEEPSEEK_API_KEY.startswith("sk-"):
        raise RuntimeError(
            f"DEEPSEEK_API_KEY 格式无效: 应以 sk- 开头（当前首字符: {DEEPSEEK_API_KEY[:3]}...）"
        )


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
LLM_MAX_RETRIES = int(os.getenv("LLM_MAX_RETRIES", "3"))
LLM_REQUEST_TIMEOUT = int(os.getenv("LLM_REQUEST_TIMEOUT", "90"))
LLM_CONCURRENT_LIMIT = int(os.getenv("LLM_CONCURRENT_LIMIT", "50"))
LLM_CONNECTION_POOL_SIZE = int(os.getenv("LLM_CONNECTION_POOL_SIZE", "60"))
LLM_CONNECTION_KEEPALIVE = int(os.getenv("LLM_CONNECTION_KEEPALIVE", "30"))

LLM_LOG_OVERFLOW_DIR = os.getenv("LLM_LOG_OVERFLOW_DIR", "/app/data/llm_logs")
LLM_LOG_OVERFLOW_MAX_SIZE_MB = int(os.getenv("LLM_LOG_OVERFLOW_MAX_SIZE_MB", "10"))
LLM_LOG_OVERFLOW_MAX_FILES = int(os.getenv("LLM_LOG_OVERFLOW_MAX_FILES", "5"))

# QA RAG 开关 —— 启用后从教材库检索相关内容注入问答 prompt
QA_RAG_ENABLED = os.getenv("QA_RAG_ENABLED", "false").lower() in ("true", "1", "yes")

# 批量建用户上限 —— 防止单次请求过大导致系统卡死
BATCH_USER_LIMIT = int(os.getenv("BATCH_USER_LIMIT", "500"))

# LLM 调用参数 —— 按 purpose 集中管理，支持 JSON 环境变量覆盖
_LLM_PURPOSE_DEFAULTS: dict[str, dict] = {
    "patient_chat": {"timeout": 30, "max_tokens": 512, "temperature": 0.6, "max_retries": 2},
    "qa": {"timeout": 30, "max_tokens": 1024, "temperature": 0.7, "max_retries": 2},
    "scoring": {
        "timeout": 120,
        "max_tokens": 4096,
        "temperature": 0,
        "max_retries": 3,
        "response_format": {"type": "json_object"},
    },
    "scoring_feedback": {
        "timeout": 60,
        "max_tokens": 2048,
        "temperature": 0.3,
        "max_retries": 2,
        "response_format": {"type": "json_object"},
    },
    "case_generation": {"timeout": 120, "max_tokens": 4096, "temperature": 0.3, "max_retries": 3},
}


def get_llm_config(purpose: str) -> dict:
    override = os.getenv("LLM_CONFIG_JSON")
    if override:
        try:
            overrides = _json.loads(override)
            if purpose in overrides:
                return overrides[purpose]
        except _json.JSONDecodeError:
            log.warning("LLM_CONFIG_JSON 解析失败，使用默认配置")
    return _LLM_PURPOSE_DEFAULTS.get(purpose, _LLM_PURPOSE_DEFAULTS["patient_chat"])


# 自动结算与智能评分
REQUEST_TIMEOUT_SECONDS = int(os.getenv("REQUEST_TIMEOUT_SECONDS", "300"))
SCORING_TIMEOUT_SECONDS = int(os.getenv("SCORING_TIMEOUT_SECONDS", "180"))
CLEANUP_INTERVAL_SECONDS = int(os.getenv("CLEANUP_INTERVAL_SECONDS", "30"))
AUTO_SCORE_COVERED_INQUIRIES_MIN = int(os.getenv("AUTO_SCORE_COVERED_INQUIRIES_MIN", "5"))
AUTO_SCORE_STUDENT_CHARS_MIN = int(os.getenv("AUTO_SCORE_STUDENT_CHARS_MIN", "200"))
AUTO_SCORE_AI_CHARS_MIN = int(os.getenv("AUTO_SCORE_AI_CHARS_MIN", "500"))


def log_config(logger):
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
