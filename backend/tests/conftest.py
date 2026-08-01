import os
import warnings

warnings.filterwarnings("ignore", message=".*httpx.*starlette.*deprecated.*")
os.environ["JWT_SECRET_KEY"] = "test-secret-key-for-testing-only"
os.environ["DEEPSEEK_API_KEY"] = "sk-test-placeholder"
# 防 SessionLocal 间接查询（如 ProfileRouter 的 DB 刷新）落到 .env 的真实开发库
os.environ["DATABASE_URL"] = os.environ.get("TEST_DB_URL", "postgresql://postgres:postgres@localhost:5432/nursing_test")
os.environ["SKIP_SEED"] = "1"
os.environ["SKIP_MIGRATION"] = "1"
os.environ["TESTING"] = "1"
