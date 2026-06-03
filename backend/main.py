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
from routers import admin_grades
from routers import admin_classes
from routers.admin_api import router as admin_api_router
from routers.admin_prompts import router as admin_prompts_router
from logger import log
from config import APP_VERSION, log_config

_startup_logger = logging.getLogger("nursing")

_MAX_REQUEST_BYTES = int(os.getenv("MAX_REQUEST_BYTES", str(10 * 1024 * 1024)))  # 默认 10MB


async def _verify_llm_key() -> bool:
    """数据库初始化前验证 LLM API Key 连通性"""
    from config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL
    from services.llm_router import set_env_fallback_state

    if not DEEPSEEK_API_KEY:
        _startup_logger.warning("DEEPSEEK_API_KEY 未设置")
        set_env_fallback_state(False, error="DEEPSEEK_API_KEY 未设置")
        return False
    if not DEEPSEEK_API_KEY.startswith("sk-") or len(DEEPSEEK_API_KEY) < 20:
        _startup_logger.warning("DEEPSEEK_API_KEY 格式无效 (需以 sk- 开头且 >=20 字符)")
        set_env_fallback_state(False, error="API Key 格式无效")
        return False

    import httpx
    t0 = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{DEEPSEEK_BASE_URL}/v1/models",
                headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}"},
            )
            ok = resp.status_code < 400
        ms = int((time.perf_counter() - t0) * 1000)
        if ok:
            _startup_logger.info("DeepSeek 密钥连通性验证通过 ✓  %dms", ms)
            set_env_fallback_state(True, latency_ms=ms)
        else:
            _startup_logger.error("DeepSeek 密钥连通性验证失败 ✗  HTTP %d, %dms", resp.status_code, ms)
            set_env_fallback_state(False, error=f"HTTP {resp.status_code}", latency_ms=ms)
        return ok
    except Exception as e:
        error_msg = str(e)[:200]
        _startup_logger.error("DeepSeek 密钥连通性验证异常 ✗  %s", e)
        set_env_fallback_state(False, error=error_msg)
        return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期 —— 按顺序启动核心服务，关闭时优雅清理。

    启动链路：
    1. 验证 DeepSeek API Key 连通性
    2. 初始化数据库 + 运行 Alembic 迁移
    3. 种子数据（首次启动创建管理员账号 + 默认病例）
    4. 种子 LLM 配置（首次启动将 .env key 写入 DB）
    5. 加载 ConfigRouter（API key 路由+熔断）
    6. 加载 PromptManager（模板热重载）
    7. 启动 LLM 日志消费者（异步批量写 DB）
    8. 启动限流器定期清理

    关闭链路：取消清理任务 → 刷写剩余日志 → 关闭 DB 连接池
    """
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

    llm_key_valid = await _verify_llm_key()

    from database import _log_connection
    _log_connection()
    init_db()
    try:
        _seed_data()
    except Exception as e:
        _startup_logger.warning("种子数据初始化失败(非致命): %s", e)
    if llm_key_valid:
        _seed_llm_configs()
    try:
        from services.llm_router import refresh_router
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


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """全局未捕获异常处理 — 确保所有 500 错误都被日志记录"""
    import traceback as _tb
    log.error(
        "未处理的异常 %s %s: %s\n%s",
        request.method, request.url.path,
        exc,
        _tb.format_exc(),
        extra={"client_ip": _get_client_ip(request)},
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "服务器内部错误，请稍后重试"},
    )

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
            log_fn = log.error if exc_type else log.info
            log_fn(
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
app.include_router(admin_grades.router)
app.include_router(admin_classes.router)


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
    """首次启动种子数据：RBAC角色权限 → 管理员账号 → 测试学生 → 内置病例。
    幂等安全：已有数据时自动跳过。SKIP_SEED=1 时跳过全流程。
    """
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
        from models import Role, RolePermission

        if db.query(Role).count() == 0:
            db.add(Role(name="teacher", display_name="教师", is_system=True))
            db.add(Role(name="student", display_name="学生", is_system=True))
            db.flush()

            teacher_perms = [
                "teacher_access", "user_manage", "case_manage", "score_review",
                "llm_monitor", "api_manage", "prompt_manage",
                "grade_class_manage",
            ]
            student_perms = ["training_access", "qa_access"]
            for p in teacher_perms:
                db.add(RolePermission(role_name="teacher", permission=p))
            for p in student_perms:
                db.add(RolePermission(role_name="student", permission=p))

        # 种子评分标准（idempotent — 首次启动从 JSON 导入到 DB，后续从 DB 读取）
        from models import Rubric
        if db.query(Rubric).count() == 0:
            import json, os as _os
            rubric_path = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "rubrics", "nursing_history_v1.json")
            if _os.path.isfile(rubric_path):
                with open(rubric_path, "r", encoding="utf-8") as f:
                    rubric_data = json.load(f)
                db.add(Rubric(
                    name=rubric_data.get("id", "nursing_history_v1"),
                    version=rubric_data.get("version", "1.0"),
                    description=rubric_data.get("name", ""),
                    total_max=rubric_data.get("total_max", 100),
                    raw_max=rubric_data.get("raw_max", 57),
                    raw_scale=rubric_data.get("raw_scale", 3),
                    dimensions=rubric_data.get("dimensions", []),
                    is_active=True,
                ))

        # 确保管理员账号始终存在
        if not db.query(User).filter(User.username == "admin").first():
            admin = User(
                username="admin",
                password_hash=hash_password("admin123"),
                role="teacher",
                display_name="管理员",
                student_id=None,
            )
            db.add(admin)
            db.flush()

        # 检查是否已初始化（跳过学生+病例种子）
        if db.query(User).filter(User.username != "admin").count() > 0:
            db.commit()
            log.info("种子数据检查完成（已有用户数据，跳过初始化）")
            return

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
        log.info("种子数据初始化完成")
    finally:
        db.close()


def _seed_llm_configs():
    """将 .env 中的 DEEPSEEK_API_KEY 写入 DB (仅首次，密钥连通性已验证)"""
    from services.crypto_utils import encrypt_api_key
    from config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, DEEPSEEK_MODEL_PRO
    from database import SessionLocal
    from models import ApiSecret, LLMConfig

    db = SessionLocal()
    try:
        if db.query(LLMConfig).count() > 0:
            _startup_logger.info("LLMConfig 已有数据，跳过 LLM seed")
            return

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
                secret_id=secret.id, label="DeepSeek Flash (QA)",
                base_url=DEEPSEEK_BASE_URL, model=DEEPSEEK_MODEL,
                purpose="qa", priority=50,
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
        _startup_logger.info("LLM seed 完成: 初始密钥 + 3 配置 (scoring=pro, qa=flash, *=flash)")
    except Exception as e:
        _startup_logger.error("LLM seed 失败: %s", e)
        db.rollback()
    finally:
        db.close()
