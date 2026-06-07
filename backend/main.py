import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from core.config import APP_VERSION, CLEANUP_INTERVAL_SECONDS, log_config, validate_config
from core.database import engine, get_db, init_db
from core.logging_setup import setup_logging
from middleware.rate_limits import RateLimiter
from routers import admin, admin_classes, admin_grades, auth, cases, chat, export, feedback, notes, nursing_records, qa, questionnaires, stats, training
from routers.admin_api import router as admin_api_router
from routers.admin_prompts import router as admin_prompts_router
from routers.admin_roles import router as admin_roles_router
from routers.admin_schools import router as admin_schools_router

log = logging.getLogger(__name__)

_MAX_REQUEST_BYTES = int(os.getenv("MAX_REQUEST_BYTES", str(10 * 1024 * 1024)))


# ── 启动辅助 ──

async def _verify_llm() -> bool:
    from core.config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL
    from services.llm import set_env_fallback_state

    if not DEEPSEEK_API_KEY or len(DEEPSEEK_API_KEY) < 20 or not DEEPSEEK_API_KEY.startswith("sk-"):
        log.warning("DEEPSEEK_API_KEY 未设置或格式无效")
        await set_env_fallback_state(False, error="API Key 未配置")
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
        if resp.status_code < 400:
            log.info("DeepSeek 连通 OK  %dms", ms)
            await set_env_fallback_state(True, latency_ms=ms)
            return True
        log.error("DeepSeek 连通失败  HTTP %d", resp.status_code)
        await set_env_fallback_state(False, error=f"HTTP {resp.status_code}")
        return False
    except Exception as e:
        log.exception("DeepSeek 连通异常")
        await set_env_fallback_state(False, error=str(e)[:200])
        return False


def _seed_data():
    from core.database import SessionLocal
    from core.roles import SYSTEM_PERMISSIONS, SYSTEM_ROLES
    from core.security import hash_password
    from models import Case, Role, RolePermission, Rubric, School, User

    db = SessionLocal()
    try:
        # 1. 确保默认学校存在
        school = db.query(School).filter(School.name == "默认学校").first()
        if not school:
            school = School(name="默认学校")
            db.add(school)
            db.flush()
            log.info("默认学校已创建")

        # 2. 确保系统模板角色存在，并同步权限 (school_id=NULL)
        template_roles = {}
        for name, display_name in SYSTEM_ROLES:
            template = db.query(Role).filter(Role.name == name, Role.school_id.is_(None)).first()
            if not template:
                template = Role(name=name, display_name=display_name, school_id=None, is_system=True)
                db.add(template)
                db.flush()
            template_roles[name] = template.id
        db.commit()

        # 清理并重建模板角色的权限
        for role_name, perms in SYSTEM_PERMISSIONS.items():
            rid = template_roles.get(role_name)
            if not rid:
                continue
            existing = {rp.permission for rp in db.query(RolePermission).filter(RolePermission.role_id == rid).all()}
            target = set(perms)
            for p in existing - target:
                db.query(RolePermission).filter(RolePermission.role_id == rid, RolePermission.permission == p).delete()
            for p in target - existing:
                db.add(RolePermission(role_id=rid, permission=p))
        db.commit()

        # 3. 确保默认学校的角色存在，并同步权限
        school_role_ids = {}
        for name, display_name in SYSTEM_ROLES:
            role = db.query(Role).filter(Role.name == name, Role.school_id == school.id).first()
            if not role:
                role = Role(name=name, display_name=display_name, school_id=school.id, is_system=True)
                db.add(role)
                db.flush()
            school_role_ids[name] = role.id
        db.commit()

        for role_name, perms in SYSTEM_PERMISSIONS.items():
            rid = school_role_ids.get(role_name)
            if not rid:
                continue
            existing = {rp.permission for rp in db.query(RolePermission).filter(RolePermission.role_id == rid).all()}
            target = set(perms)
            for p in existing - target:
                db.query(RolePermission).filter(RolePermission.role_id == rid, RolePermission.permission == p).delete()
            for p in target - existing:
                db.add(RolePermission(role_id=rid, permission=p))
        db.commit()

        # 4. 评分标准
        if db.query(Rubric).count() == 0:
            rubric_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "rubrics", "nursing_history_v1.json")
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
                log.info("评分标准已导入")

        # 5. 超级管理员
        username = os.environ.get("SEED_ADMIN_USERNAME", "admin")
        password = os.environ.get("SEED_ADMIN_PASSWORD", "admin123")
        sa_role_id = school_role_ids.get("super_admin")
        if not os.environ.get("SEED_ADMIN_USERNAME"):
            log.warning("SEED_ADMIN_* 未设置，使用默认 admin/admin123")
        admin_user = db.query(User).filter(User.username == username).first()
        if admin_user:
            if admin_user.role_id != sa_role_id or admin_user.school_id != school.id:
                admin_user.role_id = sa_role_id
                admin_user.school_id = school.id
                db.commit()
                log.info("超级管理员角色已修正 (%s → super_admin)", username)
        else:
            db.add(User(
                username=username,
                password_hash=hash_password(password),
                role_id=sa_role_id,
                school_id=school.id,
                display_name="超级管理员",
            ))
            db.commit()
            log.info("超级管理员已创建 (%s)", username)

        # 6. 测试学生和病例 (仅首次初始化)
        if db.query(User).filter(User.username != username).count() == 0:
            student_role_id = school_role_ids.get("student")
            for i in range(1, 6):
                db.add(User(
                    username=f"student{i}",
                    password_hash=hash_password("123456"),
                    role_id=student_role_id,
                    school_id=school.id,
                    display_name=f"学生{i}",
                    student_id=f"202400{i:02d}",
                ))
            log.info("测试学生已创建 (student1-5 / 123456)")

            cases_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "cases")
            case_count = 0
            for fname in sorted(os.listdir(cases_dir)):
                if fname.endswith(".json"):
                    import json as _json
                    with open(os.path.join(cases_dir, fname), encoding="utf-8") as f:
                        d = _json.load(f)
                    db.add(Case(name=d.get("name", fname), description=d.get("description", ""), case_data=d, school_id=None))
                    case_count += 1
            db.commit()
            log.info("内置病例已导入 (%d)", case_count)
    finally:
        db.close()


def _seed_llm():
    from core.config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL
    from core.database import SessionLocal
    from models import ApiSecret, LLMConfig
    from services.llm import encrypt_api_key

    db = SessionLocal()
    try:
        env_encrypted = encrypt_api_key(DEEPSEEK_API_KEY)
        suffix = DEEPSEEK_API_KEY[-4:]

        # 清理重复密钥（同 label + suffix 只保留第一个）
        dupes = db.query(ApiSecret).filter(
            ApiSecret.label == "初始服务密钥",
            ApiSecret.key_suffix == suffix,
        ).order_by(ApiSecret.id).all()
        if len(dupes) > 1:
            for d in dupes[1:]:
                db.query(LLMConfig).filter(LLMConfig.secret_id == d.id).delete()
                db.delete(d)
            db.commit()
            log.info("清理重复密钥: %d → %d", len(dupes), 1)

        matched = dupes[0] if dupes else None
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
                log.info("种子密钥已同步 (ID=%d)", matched.id)
            secret = matched
        else:
            secret = ApiSecret(label="初始服务密钥", encrypted_key=env_encrypted, key_suffix=suffix, base_url=DEEPSEEK_BASE_URL, price_input_per_1m=1.0, price_output_per_1m=2.0)
            db.add(secret)
            db.flush()
            log.info("种子密钥已创建")

        purposes = [("scoring", DEEPSEEK_MODEL), ("patient_chat", DEEPSEEK_MODEL), ("qa", DEEPSEEK_MODEL), ("case_generation", DEEPSEEK_MODEL), ("*", DEEPSEEK_MODEL)]
        for purpose, model in purposes:
            cfg = db.query(LLMConfig).filter(LLMConfig.secret_id == secret.id, LLMConfig.purpose == purpose).first()
            if cfg:
                if cfg.model != model:
                    cfg.model = model
            else:
                db.add(LLMConfig(secret_id=secret.id, model=model, purpose=purpose))
        db.commit()
        log.info("LLM 种子完成: secret#%d + %d 用途", secret.id, len(purposes))
    except Exception:
        log.exception("LLM 种子失败，使用环境变量兜底")
        db.rollback()
    finally:
        db.close()


# ── 生命周期 ──

@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    validate_config()
    log.info("虚拟患者训练系统 v%s", APP_VERSION)
    log_config(log)

    # 1. LLM 连通性
    log.info("── 1/5 LLM 连通性 ──")
    try:
        llm_key_valid = await asyncio.wait_for(_verify_llm(), timeout=15)
    except Exception:
        log.exception("LLM 验证异常")
        llm_key_valid = False
    log.info("LLM %s", "OK" if llm_key_valid else "不可用")

    # 2. 数据库
    log.info("── 2/5 数据库 ──")
    try:
        init_db()
        log.info("数据库迁移完成")
    except Exception:
        log.exception("数据库迁移失败")
        raise

    # 3. 种子数据
    log.info("── 3/5 种子数据 ──")
    try:
        await asyncio.to_thread(_seed_data)
        log.info("种子数据就绪")
        if llm_key_valid:
            await asyncio.to_thread(_seed_llm)
            log.info("LLM 配置就绪")
    except Exception:
        log.exception("种子数据初始化失败（非致命，继续启动）")

    # 4. 基础设施 —— 创建服务并挂载到 app.state
    log.info("── 4/5 基础设施 ──")
    try:
        import httpx

        from core.config import LLM_CONNECTION_KEEPALIVE, LLM_CONNECTION_POOL_SIZE
        from services.llm import ProfileRouter
        from services.prompt import PromptManager

        app.state.rate_limiter = RateLimiter()

        app.state.httpx_client = httpx.AsyncClient(
            timeout=httpx.Timeout(60, connect=15.0),
            limits=httpx.Limits(
                max_connections=LLM_CONNECTION_POOL_SIZE,
                max_keepalive_connections=LLM_CONNECTION_KEEPALIVE,
                keepalive_expiry=30,
            ),
        )

        app.state.llm_router = ProfileRouter()
        await app.state.llm_router.load_from_db()
        log.info("密钥路由就绪")

        app.state.prompt_manager = PromptManager()
        await app.state.prompt_manager.load_from_db()
        log.info("提示词管理器就绪")
    except Exception:
        log.exception("基础设施初始化失败")
        raise

    # 5. 后台服务
    log.info("── 5/5 后台服务 ──")
    from services.llm import LogWorker
    app.state.log_worker = LogWorker()
    await app.state.log_worker.start()
    log.info("LLM 日志写入器就绪")

    cleanup_task = asyncio.create_task(_rate_limiter_cleanup(app.state.rate_limiter))
    app.state._cleanup_task = cleanup_task

    from services.training import run_cleanup_loop
    settlement_task = asyncio.create_task(run_cleanup_loop())
    app.state._settlement_task = settlement_task
    log.info("自动结算就绪 (间隔=%ds)", CLEANUP_INTERVAL_SECONDS)

    _loop = asyncio.get_running_loop()
    _loop.set_exception_handler(_handle_task_exception)

    log.info("── 启动完成 ──")

    yield

    # ── 关闭 ──
    log.info("正在关闭...")
    cleanup_task.cancel()
    with suppress(asyncio.CancelledError):
        await cleanup_task
    settlement_task.cancel()
    with suppress(asyncio.CancelledError):
        await settlement_task
    await app.state.log_worker.stop()
    if app.state.httpx_client:
        await app.state.httpx_client.aclose()
    await asyncio.to_thread(engine.dispose)
    log.info("服务已关闭")


async def _rate_limiter_cleanup(rate_limiter: RateLimiter):
    while True:
        await asyncio.sleep(600)
        await rate_limiter.cleanup()


def _handle_task_exception(loop, ctx):
    msg = ctx.get("message", "")
    exc = ctx.get("exception")
    task_name = getattr(ctx.get("task"), "get_name", lambda: "?")() if ctx.get("task") else "?"
    log.error("asyncio task 异常 %s: %s | %s", task_name, msg, exc)


# ── 应用 ──

app = FastAPI(title="虚拟患者训练系统", version=APP_VERSION, lifespan=lifespan)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    if isinstance(exc, HTTPException):
        raise exc
    log.error("未处理异常 %s %s: %s", request.method, request.url.path, exc)
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


app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:8000").split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 路由注册 ──
for mod in [auth, admin, admin_classes, admin_grades, cases, chat, export, feedback, notes, nursing_records, qa, questionnaires, stats, training]:
    app.include_router(mod.router)
app.include_router(admin_api_router)
app.include_router(admin_prompts_router)
app.include_router(admin_schools_router)
app.include_router(admin_roles_router)


@app.get("/api/health")
async def health(request: Request):
    health_info = {"status": "ok", "version": APP_VERSION}
    try:
        db = next(get_db())
        try:
            db.execute(text("SELECT 1"))
            health_info["db"] = "ok"
        finally:
            db.close()
    except Exception:
        health_info["db"] = "error"
        health_info["status"] = "degraded"
    try:
        from services.llm import get_env_fallback_state
        fb = await get_env_fallback_state()
        health_info["llm"] = "ok" if fb.get("available") else "unavailable"
        if not fb.get("available"):
            health_info["status"] = "degraded"
    except Exception:
        health_info["llm"] = "unknown"
    return health_info
