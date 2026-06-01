import os
import asyncio
import logging
import time
import uuid
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.orm import Session
from database import init_db, engine, get_db
from routers import auth, cases, training, chat, export, admin, notes, qa, stats, feedback
from routers.admin_api import router as admin_api_router
from routers.admin_prompts import router as admin_prompts_router
from logger import audit_logger
from config import APP_VERSION, log_config

_startup_logger = logging.getLogger("nursing")

_MAX_REQUEST_BYTES = int(os.getenv("MAX_REQUEST_BYTES", str(10 * 1024 * 1024)))  # 默认 10MB


@asynccontextmanager
async def lifespan(app: FastAPI):
    _startup_logger.info(
        "\n"
        "  _   __              _               __      ______  _____ \n"
        " | | / /             (_)              \\ \\    / /  _ \\|  __ \\\n"
        " | |/ / _   _  _ __  _  __ _  _   _   \\ \\  / /| |_) | |__) |\n"
        " |    \\| | | || '__|| |/ _` || | | |   \\ \\/ / |  __/|  ___/\n"
        " | |\\  \\ |_| || |   | | (_| || |_| |    \\  /  | |   | |\n"
        " \\_| \\_/\\__,_||_|   |_|\\__, | \\__,_|     \\/   |_|   |_|\n"
        "                         __/ |\n"
        "                        |___/    虚拟患者训练系统"
    )
    log_config(_startup_logger)
    from database import _log_connection
    _log_connection()
    init_db()
    try:
        _seed_data()
    except Exception as e:
        _startup_logger.warning("种子数据初始化失败(非致命): %s", e)
    # 初始化 LLMRouter 并 seed 默认 provider
    try:
        from services.llm_router import refresh_router
        from services.crypto_utils import encrypt_api_key
        from config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, DEEPSEEK_MODEL_PRO
        from database import SessionLocal
        from models import ApiSecret, LLMConfig

        db = SessionLocal()
        try:
            if db.query(LLMConfig).count() > 0:
                _startup_logger.info("LLMConfig 已有数据，跳过 seed")
            elif DEEPSEEK_API_KEY and DEEPSEEK_API_KEY.startswith("sk-") and len(DEEPSEEK_API_KEY) >= 20:
                import httpx, time as _time
                t0 = _time.perf_counter()
                key_ok = False
                try:
                    async with httpx.AsyncClient(timeout=10) as _client:
                        resp = await _client.get(
                            f"{DEEPSEEK_BASE_URL}/v1/models",
                            headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}"},
                        )
                        key_ok = resp.status_code < 400
                    ms = int((_time.perf_counter() - t0) * 1000)
                    if key_ok:
                        _startup_logger.info("DeepSeek 密钥有效 ✓  %dms", ms)
                except Exception as _e:
                    _startup_logger.error("DeepSeek 密钥无效 ✗  %s", _e)

                if not key_ok:
                    pass  # skip seed
                else:
                    suffix = DEEPSEEK_API_KEY[-4:]
                    secret = ApiSecret(
                        label="初始服务密钥",
                        encrypted_key=encrypt_api_key(DEEPSEEK_API_KEY),
                        key_suffix=suffix,
                    )
                    db.add(secret)
                    db.flush()

                    cfgs = [
                        LLMConfig(
                            secret_id=secret.id, label="DeepSeek Pro",
                            base_url=DEEPSEEK_BASE_URL, model=DEEPSEEK_MODEL_PRO,
                            purpose="scoring", priority=10,
                            price_input_per_1m=1, price_output_per_1m=2,
                        ),
                        LLMConfig(
                            secret_id=secret.id, label="DeepSeek Flash",
                            base_url=DEEPSEEK_BASE_URL, model=DEEPSEEK_MODEL,
                            purpose="*", priority=100,
                            price_input_per_1m=1, price_output_per_1m=2,
                        ),
                    ]
                    db.add_all(cfgs)
                    db.commit()
                    _startup_logger.info("已 seed 初始服务密钥 + 2 配置 (pro=评分, flash=通配)")
            else:
                if not DEEPSEEK_API_KEY:
                    _startup_logger.warning("DEEPSEEK_API_KEY 未设置，跳过 seed")
                else:
                    _startup_logger.warning("DEEPSEEK_API_KEY 格式无效 (需以 sk- 开头且 >=20 字符)，跳过 seed")
        finally:
            db.close()

        await refresh_router()
    except Exception as e:
        _startup_logger.error("ConfigRouter 初始化失败: %s", e)
    # 初始化 PromptManager 并 seed 默认模板
    try:
        from services.prompt_manager import get_prompt_manager
        await get_prompt_manager()
        _startup_logger.info("PromptManager 初始化完成")
    except Exception as e:
        _startup_logger.error("PromptManager 初始化失败: %s", e)
    # 启动 LLM 日志消费者
    from services.llm_logging import start_worker, stop_worker
    await start_worker()
    # 限流器后台清理（每 10 分钟）
    from rate_limiter import _limiter as rate_limiter
    shutdown_flag = False
    async def _cleanup_loop():
        while not shutdown_flag:
            await asyncio.sleep(600)
            rate_limiter.cleanup()
    cleanup_task = asyncio.create_task(_cleanup_loop())
    yield
    _startup_logger.info("正在关闭服务...")
    shutdown_flag = True
    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass
    await stop_worker()
    from services.llm_service import _shared_client
    if _shared_client:
        await _shared_client.aclose()
    _startup_logger.info("释放数据库连接池...")
    engine.dispose()
    _startup_logger.info("服务已关闭")


app = FastAPI(title="虚拟患者训练系统", version=APP_VERSION, lifespan=lifespan)

_cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:8000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _cors_origins if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from rate_limiter import _get_client_ip


def _try_extract_user(request: Request) -> tuple:
    """尝试从 Authorization 头解析用户信息，用于日志记录。解析失败返回 None。"""
    from jose import jwt as _jwt
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None, None
    try:
        from config import SECRET_KEY, ALGORITHM
        payload = _jwt.decode(auth_header[7:], SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("user_id"), payload.get("role")
    except Exception:
        return None, None


@app.middleware("http")
async def request_id_and_audit_middleware(request: Request, call_next):
    """为每个请求分配唯一 ID，记录请求摘要"""
    rid = request.headers.get("X-Request-ID", str(uuid.uuid4())[:8])
    request.state.request_id = rid
    t0 = time.time()

    class _audit_scope:
        def __init__(self, rid, req):
            self.rid = rid
            self.req = req
            self.status = 0

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_val, exc_tb):
            duration_ms = round((time.time() - t0) * 1000)
            user_id, user_role = _try_extract_user(self.req)
            audit_logger.info(
                "%s %s → %s (%.0fms)%s",
                self.req.method, self.req.url.path,
                self.status or (500 if exc_type else 0),
                duration_ms,
                f" | {exc_val}" if exc_type else "",
                extra={
                    "request_id": self.rid,
                    "user_id": user_id,
                    "user_role": user_role,
                    "client_ip": _get_client_ip(self.req),
                    "error": str(exc_val) if exc_type else None,
                },
            )
            if not exc_type:
                try:
                    from starlette.responses import Response
                    if hasattr(self, "_response"):
                        self._response.headers["X-Request-ID"] = self.rid
                except Exception:
                    pass
            return False

    with _audit_scope(rid, request) as ctx:
        try:
            response = await call_next(request)
            ctx.status = response.status_code
            ctx._response = response
            return response
        except Exception:
            ctx.status = 500
            raise


@app.middleware("http")
async def limit_request_size(request: Request, call_next):
    """拒绝超大请求体，防止内存耗尽"""
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > _MAX_REQUEST_BYTES:
        return JSONResponse(
            status_code=413,
            content={"detail": f"请求体过大，最大允许 {_MAX_REQUEST_BYTES // (1024*1024)}MB"},
        )
    return await call_next(request)

app.include_router(auth.router)
app.include_router(cases.router)
app.include_router(training.router)
app.include_router(chat.router)
app.include_router(export.router)
app.include_router(admin.router)
app.include_router(notes.router)
app.include_router(qa.router)
app.include_router(feedback.router)
app.include_router(stats.router)
app.include_router(admin_api_router)
app.include_router(admin_prompts_router)


@app.get("/api")
def root():
    return {"message": "虚拟患者训练系统 API", "version": APP_VERSION}


@app.get("/api/health")
def health_check(db: Session = Depends(get_db)):
    """健康检查：验证数据库连接和服务状态"""
    from config import APP_VERSION
    try:
        db.execute(text("SELECT 1"))
        return {
            "status": "healthy",
            "database": "connected",
            "version": APP_VERSION,
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"数据库连接失败: {str(e)}")


# 生产模式：服务前端构建产物
FRONTEND_DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend", "dist")
if os.path.isdir(FRONTEND_DIST):
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")


def _seed_data():
    """初始化种子数据：管理员账号和病例"""
    import os as _os
    if _os.environ.get("SKIP_SEED"):
        return

    from database import SessionLocal
    from models import User, Case
    from auth import hash_password
    import json
    import os

    db = SessionLocal()
    try:
        # 检查是否已初始化
        if db.query(User).count() > 0:
            return

        # 创建默认教师账号
        admin = User(
            username="admin",
            password_hash=hash_password("admin123"),
            role="teacher",
            display_name="管理员",
            student_id=None,
        )
        db.add(admin)

        # 创建测试学生账号
        for i in range(1, 6):
            student = User(
                username=f"student{i}",
                password_hash=hash_password("123456"),
                role="student",
                display_name=f"学生{i}",
                student_id=f"202400{i:02d}",
            )
            db.add(student)

        # 导入病例数据
        cases_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cases")
        for case_file in sorted(os.listdir(cases_dir)):
            if case_file.endswith(".json"):
                with open(os.path.join(cases_dir, case_file), "r", encoding="utf-8") as f:
                    case_data = json.load(f)
                case = Case(
                    name=case_data.get("name", case_file),
                    description=case_data.get("description", ""),
                    case_data=case_data,
                )
                db.add(case)

        db.commit()
        audit_logger.info("种子数据初始化完成")
    finally:
        db.close()
