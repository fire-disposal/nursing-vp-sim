import asyncio
import logging
import os
import sys
import time
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import APP_VERSION, log_config
from database import engine, init_db
from routers import admin, admin_classes, admin_grades, auth, cases, chat, export, feedback, notes, qa, stats, training
from routers.admin_api import router as admin_api_router
from routers.admin_prompts import router as admin_prompts_router

# ── 彩色日志 ──
_RESET = "\033[0m"
_COLORS = {
    logging.DEBUG: "\033[36m",
    logging.INFO: "\033[32m",
    logging.WARNING: "\033[33m",
    logging.ERROR: "\033[31m",
    logging.CRITICAL: "\033[35m",
}
_NAME_COLOR = "\033[34m"


class _ColorFormatter(logging.Formatter):
    def format(self, record):
        record = logging.makeLogRecord(record.__dict__)
        lvl_color = _COLORS.get(record.levelno, "")
        record.levelname = f"{lvl_color}{record.levelname:<8}{_RESET}"
        record.name = f"{_NAME_COLOR}{record.name}{_RESET}"
        return super().format(record)


_handler = logging.StreamHandler(sys.stderr)
_handler.setFormatter(_ColorFormatter(fmt="%(levelname)s %(name)s %(message)s"))
logging.basicConfig(level=logging.INFO, handlers=[_handler], force=True)
logging.getLogger("alembic").setLevel(logging.WARNING)

log = logging.getLogger(__name__)

_MAX_REQUEST_BYTES = int(os.getenv("MAX_REQUEST_BYTES", str(10 * 1024 * 1024)))


# ── 启动步骤 ──

def _step(msg: str):
    """辅助：输出启动步骤日志并刷新 stderr，确保崩溃前可见"""
    log.info(msg)
    sys.stderr.flush()


async def _startup_verify_llm() -> bool:
    from config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL
    from services.llm_router import set_env_fallback_state

    if not DEEPSEEK_API_KEY or len(DEEPSEEK_API_KEY) < 20 or not DEEPSEEK_API_KEY.startswith("sk-"):
        log.warning("DEEPSEEK_API_KEY 未设置或格式无效")
        set_env_fallback_state(False, error="API Key 未配置")
        return False

    import httpx
    t0 = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{DEEPSEEK_BASE_URL}/v1/models",
                headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}"},
            )
        ms = int((time.perf_counter() - t0) * 1000)
        ok = resp.status_code < 400
        if ok:
            log.info("DeepSeek 连通 ✓  %dms", ms)
            set_env_fallback_state(True, latency_ms=ms)
        else:
            log.error("DeepSeek 连通失败 ✗  HTTP %d", resp.status_code)
            set_env_fallback_state(False, error=f"HTTP {resp.status_code}")
        return ok
    except Exception as e:
        log.exception("DeepSeek 连通异常")
        set_env_fallback_state(False, error=str(e)[:200])
        return False


def _startup_seed():
    from auth import hash_password
    from database import SessionLocal
    from models import Case, Role, RolePermission, Rubric, User

    db = SessionLocal()
    try:
        # RBAC
        if db.query(Role).count() == 0:
            db.add_all([
                Role(name="teacher", display_name="教师", is_system=True),
                Role(name="student", display_name="学生", is_system=True),
            ])
            db.flush()
            for perm_list, role_name in [
                (["teacher_access", "user_manage", "case_manage", "score_review", "llm_monitor", "api_manage", "prompt_manage", "grade_class_manage"], "teacher"),
                (["training_access", "qa_access"], "student"),
            ]:
                for p in perm_list:
                    db.add(RolePermission(role_name=role_name, permission=p))
            db.commit()
            log.info("✓ RBAC 已初始化")

        # Rubric
        if db.query(Rubric).count() == 0:
            rubric_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rubrics", "nursing_history_v1.json")
            if os.path.isfile(rubric_path):
                import json as _json
                with open(rubric_path, encoding="utf-8") as f:
                    data = _json.load(f)
                db.add(Rubric(
                    name=data.get("id", "nursing_history_v1"),
                    version=data.get("version", "1.0"),
                    description=data.get("name", ""),
                    total_max=data.get("total_max", 100),
                    raw_max=data.get("raw_max", 57),
                    raw_scale=data.get("raw_scale", 3),
                    dimensions=data.get("dimensions", []),
                    is_active=True,
                ))
                db.commit()
                log.info("✓ 评分标准已导入")

        # Admin
        username = os.environ.get("SEED_ADMIN_USERNAME", "admin")
        password = os.environ.get("SEED_ADMIN_PASSWORD", "admin123")
        if not os.environ.get("SEED_ADMIN_USERNAME"):
            log.warning("⚠ SEED_ADMIN_* 未设置，使用默认 admin/admin123")
        if not db.query(User).filter(User.username == username).first():
            db.add(User(username=username, password_hash=hash_password(password), role="teacher", display_name="管理员"))
            db.commit()
            log.info("✓ 管理员已创建 (%s)", username)

        # Test students + cases (only on fresh DB)
        if db.query(User).filter(User.username != username).count() == 0:
            for i in range(1, 6):
                db.add(User(username=f"student{i}", password_hash=hash_password("123456"), role="student", display_name=f"学生{i}", student_id=f"202400{i:02d}"))
            log.info("✓ 测试学生已创建 (student1-5 / 123456)")

            cases_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cases")
            case_count = 0
            for fname in sorted(os.listdir(cases_dir)):
                if fname.endswith(".json"):
                    import json as _json
                    with open(os.path.join(cases_dir, fname), encoding="utf-8") as f:
                        d = _json.load(f)
                    db.add(Case(name=d.get("name", fname), description=d.get("description", ""), case_data=d))
                    case_count += 1
            db.commit()
            log.info("✓ 内置病例已导入 (%d)", case_count)
    finally:
        db.close()


def _startup_llm_seed():
    from config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL
    from database import SessionLocal
    from models import ApiSecret, LLMConfig
    from services.crypto_utils import encrypt_api_key

    db = SessionLocal()
    try:
        env_encrypted = encrypt_api_key(DEEPSEEK_API_KEY)
        suffix = DEEPSEEK_API_KEY[-4:]

        matched = next((s for s in db.query(ApiSecret).all() if s.encrypted_key == env_encrypted), None)
        if matched:
            changed = any([
                matched.base_url != DEEPSEEK_BASE_URL,
                float(matched.price_input_per_1m or 0) == 0,
                float(matched.price_output_per_1m or 0) == 0,
            ])
            if matched.base_url != DEEPSEEK_BASE_URL:
                matched.base_url = DEEPSEEK_BASE_URL
            if float(matched.price_input_per_1m or 0) == 0:
                matched.price_input_per_1m = 1.0
            if float(matched.price_output_per_1m or 0) == 0:
                matched.price_output_per_1m = 2.0
            if changed:
                db.commit()
                log.info("✓ 种子密钥已同步 (ID=%d)", matched.id)
            secret = matched
        else:
            secret = ApiSecret(label="初始服务密钥", encrypted_key=env_encrypted, key_suffix=suffix, base_url=DEEPSEEK_BASE_URL, price_input_per_1m=1.0, price_output_per_1m=2.0)
            db.add(secret)
            db.flush()
            log.info("✓ 种子密钥已创建")

        purposes = [("scoring", DEEPSEEK_MODEL), ("patient_chat", DEEPSEEK_MODEL), ("qa", DEEPSEEK_MODEL), ("case_generation", DEEPSEEK_MODEL), ("*", DEEPSEEK_MODEL)]
        for purpose, model in purposes:
            cfg = db.query(LLMConfig).filter(LLMConfig.secret_id == secret.id, LLMConfig.purpose == purpose).first()
            if cfg:
                if cfg.model != model:
                    cfg.model = model
            else:
                db.add(LLMConfig(secret_id=secret.id, model=model, purpose=purpose))
        db.commit()
        log.info("✓ LLM 种子完成: secret#%d + %d 用途", secret.id, len(purposes))
    except Exception:
        log.exception("⚠ LLM 种子失败，使用环境变量兜底")
        db.rollback()
    finally:
        db.close()


async def _startup_router():
    from services.llm_router import refresh_router
    await refresh_router()


async def _startup_prompts():
    from services.prompt_manager import get_prompt_manager
    await get_prompt_manager()


# ── 生命周期 ──

@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("虚拟患者训练系统")
    log_config(log)

    # 1. LLM 连通性
    _step("── 1/5 LLM 密钥 ──")
    try:
        llm_key_valid = await asyncio.wait_for(_startup_verify_llm(), timeout=15)
    except Exception:
        log.exception("LLM 验证异常")
        llm_key_valid = False
    _step(f"  {'✓' if llm_key_valid else '⚠'} LLM 密钥验证{'通过' if llm_key_valid else '使用回退'}")

    # 2. 数据库
    _step("── 2/5 数据库 ──")
    from database import _log_connection
    _log_connection()
    init_db()
    _step("  ✓ 数据库迁移完成")

    # 3. 种子
    _step("── 3/5 种子数据 ──")
    _startup_seed()
    _step("  ✓ 种子数据就绪")

    if llm_key_valid:
        _startup_llm_seed()
        _step("  ✓ LLM 配置就绪")

    # 4. 基础设施
    _step("── 4/5 路由 & 提示词 ──")
    await asyncio.wait_for(_startup_router(), timeout=10)
    _step("  ✓ 密钥路由就绪")
    await asyncio.wait_for(_startup_prompts(), timeout=10)
    _step("  ✓ 提示词管理器就绪")

    # 5. 后台服务
    _step("── 5/5 后台服务 ──")
    from services.llm_logging import start_worker, stop_worker
    await start_worker()
    log.info("  ✓ LLM 日志写入器")

    from rate_limiter import _limiter as rate_limiter
    _loop = asyncio.get_running_loop()

    def _handle_task_exception(loop, ctx):
        msg = ctx.get("message", "")
        exc = ctx.get("exception")
        task_name = getattr(ctx.get("task"), "get_name", lambda: "?")() if ctx.get("task") else "?"
        log.error("asyncio task 异常 %s: %s | %s", task_name, msg, exc)

    _loop.set_exception_handler(_handle_task_exception)

    shutdown_flag = False

    async def _cleanup_loop():
        while not shutdown_flag:
            await asyncio.sleep(600)
            rate_limiter.cleanup()

    cleanup_task = asyncio.create_task(_cleanup_loop())
    _step("  ✓ 限流器清理循环")
    _step("── 启动完成 ──")
    sys.stderr.flush()

    yield

    # ── 关闭 ──
    log.info("正在关闭...")
    shutdown_flag = True
    cleanup_task.cancel()
    with suppress(asyncio.CancelledError):
        await cleanup_task
    await stop_worker()
    from services.llm_service import _shared_client
    if _shared_client:
        await _shared_client.aclose()
    engine.dispose()
    log.info("服务已关闭")


# ── 应用 ──

app = FastAPI(title="虚拟患者训练系统", version=APP_VERSION, lifespan=lifespan)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    log.error("未处理异常 %s %s: %s", request.method, request.url.path, exc, exc_info=True)
    return JSONResponse(status_code=500, content={"detail": "服务器内部错误"})


@app.middleware("http")
async def _log_requests(request: Request, call_next):
    t0 = time.perf_counter()
    response = await call_next(request)
    ms = int((time.perf_counter() - t0) * 1000)
    if response.status_code >= 500:
        log.error("%s %s → %d [%dms]", request.method, request.url.path, response.status_code, ms)
    elif response.status_code >= 400:
        log.warning("%s %s → %d [%dms]", request.method, request.url.path, response.status_code, ms)
    return response


@app.middleware("http")
async def _limit_body_size(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > _MAX_REQUEST_BYTES:
        return JSONResponse(status_code=413, content={"detail": "请求体过大"})
    return await call_next(request)


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:8000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 路由注册 ──
for mod in [auth, admin, admin_classes, admin_grades, cases, chat, export, feedback, notes, qa, stats, training]:
    app.include_router(getattr(mod, "router"))
app.include_router(admin_api_router)
app.include_router(admin_prompts_router)


@app.get("/api/health")
def health():
    return {"status": "ok", "version": APP_VERSION}
