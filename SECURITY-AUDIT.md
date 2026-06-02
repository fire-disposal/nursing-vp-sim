# Security Audit Report

> 2026-06-01 — 2026-06-02 更新。标注 `[已解决]` / `[开发环境]` / `[待处理]`。

## 待处理

### 1. Hardcoded Seed Credentials on First Run
**File:** `backend/main.py:264-335`

`_seed_data()` 在空数据库自动创建 `admin/admin123` + `student1..5/123456`。若生产 DB 被重建，攻击者可立即获取管理员权限。**建议：** 生产环境设 `SKIP_SEED=1` 或 `ENV=production` 时跳过。

### 2. SECRET_KEY Accepts Weak Keys
**File:** `backend/config.py:21-28`

仅拒绝 3 个占位符字符串。`test`、`dev` 等短密钥通过校验，使 JWT 签名可暴力破解。**建议：** `len(SECRET_KEY) >= 32`。

### 3. CORS Allows Arbitrary Origins with Credentials
**File:** `backend/main.py:134-140`

`allow_credentials=True` + env 配置 `CORS_ORIGINS`。若 CORS_ORIGINS 配置错误，攻击者域名可携带 Cookie 读取请求。**建议：** 生产环境使用白名单验证。

### 4. All Environment Variables Leaked to pg_dump
**File:** `backend/routers/admin.py:305`

`os.environ.copy()` 将所有 env（含 SECRET_KEY、DEEPSEEK_API_KEY）传给 `pg_dump` 子进程。**建议：** 仅传 `PGPASSWORD` + `PATH`。

### 5. Backup Endpoint Unthrottled
**File:** `backend/routers/admin.py:297-342`

备份端点无频率限制，重复调用可填满磁盘。**建议：** 加冷却时间或去重。

### 6. SLSA Provenance Disabled
**File:** `.github/workflows/staging.yml`

`provenance: false` 阻止构建认证。**建议：** 启用 `provenance: true`。

---

## 已解决 / 可忽略

### ~~DB Port Exposed on 0.0.0.0~~ → 已处理
DB 端口已绑定 `127.0.0.1:5433`，生产 + staging 均正确隔离。

### ~~Dev Compose Ports on 0.0.0.0~~ → 开发环境
`docker-compose.yml` 是本地开发文件，CD 部署使用 `deploy/docker-compose.prod.yml`，端口已绑定 127.0.0.1。

### ~~Default Credentials~~ → 仅开发/测试使用
`DATABASE_URL` 和 `TEST_DB_URL` 默认值仅用于本地开发，生产由 compose 覆盖。

### ~~LLMConfig URL Validation~~ → 低优先级
`LLMConfigCreate.base_url` 仅有 `max_length=200`，无 URL 格式校验。管理面板仅供教师访问，风险极低。
