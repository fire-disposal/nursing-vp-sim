# Security Audit Report

> Generated 2026-06-01 — comprehensive review of environment injection, secrets handling, and deployment pipeline.

## CRITICAL

### 1. Hardcoded Seed Credentials on First Run
**File:** `backend/main.py:239-252, 224-273`

`_seed_data()` auto-creates accounts when DB is empty:
- `admin / admin123` (teacher)
- `student1..5 / 123456` (student)

If production DB is recreated, attacker gains immediate admin access. **Mitigation:** Gate seed behind `ENV != "production"` or require first-run password setup.

### 2. SSH Heredoc Expands GitHub Secrets Unquoted
**File:** `.github/workflows/cd.yml:96,119`

`ssh "$USER@$HOST" << DEPLOY` (unquoted delimiter) expands `${{ secrets.GITHUB_TOKEN }}` before sending to server. Although GITHUB_TOKEN is alphanumeric, any secrets with shell metacharacters could inject commands. **Mitigation:** Quote heredoc delimiter and pass secrets via environment variables.

### 3. Test DB Port Exposed on 0.0.0.0
**Files:** `docker-compose.test.yml:13`, `.github/workflows/ci.yml:24`

`ports: "5432:5432"` binds PostgreSQL to all interfaces. In non-isolated networks, this allows external connections using hardcoded `postgres:postgres` credentials. **Mitigation:** Bind to `127.0.0.1:5432:5432` or remove port mapping in CI (healthcheck runs in same Docker network).

---

## IMPORTANT

### 4. SECRET_KEY Accepts Weak Keys
**File:** `backend/config.py:21-28`

Only 3 exact placeholder strings are rejected. Short keys like `test` or `dev` are accepted, making HS256 JWT signatures trivially brute-forceable. **Mitigation:** Add minimum length check (`len(key) >= 32`).

### 5. CORS Allows Arbitrary Origins with Credentials
**File:** `backend/main.py:121-128`

`allow_credentials=True` with `allow_origins` from user-configured env var. If CORS_ORIGINS includes attacker domain, JavaScript on that domain can carry cookies and read Authorization headers. **Mitigation:** Validate origins against a known allowlist in production.

### 6. SSH Host Key Errors Silently Suppressed
**File:** `.github/workflows/cd.yml:93`

`ssh-keyscan -H "$HOST" >> ~/.ssh/known_hosts 2>/dev/null` — if `ssh-keyscan` fails (DNS resolution, network), stderr is discarded, and SSH may fall back to interactive host key prompt or accept unknown keys. **Mitigation:** Remove `2>/dev/null` and handle failure explicitly, or pre-configure known host keys.

### 7. All Environment Variables Leaked to Subprocess
**File:** `backend/routers/admin.py:176`

`os.environ.copy()` passes every env var (including SECRET_KEY, DEEPSEEK_API_KEY) to `pg_dump` subprocess. Process monitoring tools can read `/proc/<pid>/environ`. **Mitigation:** Construct minimal env dict with only `PGPASSWORD` + `PATH`.

---

## MINOR

### 8. Default Credentials in Multiple Locations
**Files:** `config.py:19`, `conftest.py:9`, `ci.yml:79`

`postgresql://postgres:postgres@...` used as default DATABASE_URL/TEST_DB_URL. If deployed without override, connects to default credentials. **Mitigation:** Remove defaults in production paths.

### 9. Development Compose Exposes Ports on 0.0.0.0
**File:** `docker-compose.yml:27,48`

Backend (8000) and frontend (80) ports bound to all interfaces. The CD pipeline correctly re-binds to 127.0.0.1, but the checked-in file is unsafe for direct use. **Mitigation:** Bind to `127.0.0.1` or add warning comment.

### 10. LLMConfig URL Lacks Format Validation
**File:** `backend/schemas.py:466-475`

`LLMConfigCreate.base_url` has no URL validation. `ApiProviderCreate` had a `@field_validator` for the same field. **Mitigation:** Add the same `http://`/`https://` prefix check.

### 11. Database Backup Endpoint Unthrottled
**File:** `backend/routers/admin.py:168-199`

Backup endpoint (teacher-only) has no rate limiting. Repeated calls could fill `/tmp` with concurrent backup operations. **Mitigation:** Add cooldown or request deduplication.

### 12. SLSA Provenance Disabled
**File:** `.github/workflows/cd.yml:55,68`

`provenance: false` prevents build attestation. Cannot verify artifact integrity from runtime to source commit. **Mitigation:** Enable `provenance: true` (MediaType compatibility is now resolved).

---

## No Findings

- **No eval/exec injection:** No dynamic code execution from environment variables found.
- **No SQL injection in raw queries:** `sa.text()` usage in migrations operates on DB data, not user input.
- **Encryption key derivation secure:** `crypto_utils.py` uses `hashlib.sha256(SECRET_KEY.encode()).digest()` for Fernet key derivation.
