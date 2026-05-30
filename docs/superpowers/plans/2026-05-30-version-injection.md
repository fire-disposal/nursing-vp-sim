# Version Injection via CI/CD Build Args — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate hardcoded version strings and inject version from git tag via Docker build args in CD pipeline.

**Architecture:** CD workflow (`cd.yml`) already extracts tag version via `docker/metadata-action`. We pass it as `--build-arg APP_VERSION` to both Dockerfiles, which set it as an env var. Backend reads via `os.getenv("APP_VERSION")`, frontend via Vite's `import.meta.env.VITE_APP_VERSION` at build time.

**Tech Stack:** Docker build args, Vite env vars (`VITE_*` prefix), FastAPI config, GitHub Actions

---

### Task 1: Inject version into backend Docker image

**Files:**
- Modify: `Dockerfile.backend`

- [ ] **Step 1: Add ARG/ENV to Dockerfile.backend**

After `WORKDIR /app` (line 3), before `RUN apt-get` (line 5), insert:

```dockerfile
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
```

Full resulting file:

```dockerfile
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app

ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/ .
RUN uv sync --frozen --no-dev && mkdir -p /app/data

ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
```

- [ ] **Step 2: Verify local build works**

```bash
docker build -f Dockerfile.backend -t nursing-backend:test --build-arg APP_VERSION=dev .
```

Expected: Build succeeds, no errors.

- [ ] **Step 3: Verify env var inside container**

```bash
docker run --rm nursing-backend:test sh -c 'echo $APP_VERSION'
```

Expected output: `dev`

- [ ] **Step 4: Commit**

```bash
git add Dockerfile.backend
git commit -m "feat: accept APP_VERSION build arg in backend Dockerfile"
```

---

### Task 2: Inject version into frontend Docker image

**Files:**
- Modify: `Dockerfile.frontend`

- [ ] **Step 1: Add ARG/ENV to Dockerfile.frontend builder stage**

After `WORKDIR /app` (line 2), before `COPY frontend/package.json` (line 3), insert:

```dockerfile
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=${APP_VERSION}
```

Full resulting file:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=${APP_VERSION}
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
```

- [ ] **Step 2: Verify local build works**

```bash
docker build -f Dockerfile.frontend -t nursing-frontend:test --build-arg APP_VERSION=dev .
```

Expected: Build succeeds.

- [ ] **Step 3: Verify Vite inlined the env var**

```bash
docker run --rm --entrypoint sh nursing-frontend:test -c "grep -r 'dev' /usr/share/nginx/html/assets/*.js | head -5"
```

Expected: The bundled JS contains the string `"dev"` (Vite inlines `VITE_*` vars at build time).

- [ ] **Step 4: Commit**

```bash
git add Dockerfile.frontend
git commit -m "feat: accept APP_VERSION build arg in frontend Dockerfile"
```

---

### Task 3: Pass build arg in CD workflow

**Files:**
- Modify: `.github/workflows/cd.yml`

- [ ] **Step 1: Add build-args to backend build-push-action**

In the "Build & push backend" step (line 44), add after `tags:`:

```yaml
          build-args: |
            APP_VERSION=${{ steps.meta.outputs.version }}
```

The backend build-push-action block becomes:

```yaml
      - name: Build & push backend
        uses: docker/build-push-action@v6
        with:
          context: .
          file: Dockerfile.backend
          push: true
          tags: ${{ env.REGISTRY }}/${{ steps.owner.outputs.value }}/nursing-vp-sim-backend:${{ steps.meta.outputs.version }}
          build-args: |
            APP_VERSION=${{ steps.meta.outputs.version }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          provenance: false
```

- [ ] **Step 2: Add build-args to frontend build-push-action**

In the "Build & push frontend" step (line 55), add after `tags:`:

```yaml
          build-args: |
            APP_VERSION=${{ steps.meta.outputs.version }}
```

The frontend build-push-action block becomes:

```yaml
      - name: Build & push frontend
        uses: docker/build-push-action@v6
        with:
          context: .
          file: Dockerfile.frontend
          push: true
          tags: ${{ env.REGISTRY }}/${{ steps.owner.outputs.value }}/nursing-vp-sim-frontend:${{ steps.meta.outputs.version }}
          build-args: |
            APP_VERSION=${{ steps.meta.outputs.version }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          provenance: false
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/cd.yml
git commit -m "feat: pass APP_VERSION build arg in CD workflow"
```

---

### Task 4: Change backend fallback version to "dev"

**Files:**
- Modify: `backend/config.py:13`

- [ ] **Step 1: Replace hardcoded fallback**

Change line 13 from:

```python
APP_VERSION = os.getenv("APP_VERSION", "2026.05.29")
```

to:

```python
APP_VERSION = os.getenv("APP_VERSION", "dev")
```

- [ ] **Step 2: Commit**

```bash
git add backend/config.py
git commit -m "refactor: change APP_VERSION fallback to dev"
```

---

### Task 5: Wire FastAPI version to config.APP_VERSION

**Files:**
- Modify: `backend/main.py:1,43`

- [ ] **Step 1: Add import at top of main.py**

After the existing imports (after line 14: `from logger import audit_logger`), add:

```python
from config import APP_VERSION
```

- [ ] **Step 2: Replace hardcoded version**

Change line 43 from:

```python
app = FastAPI(title="虚拟患者训练系统", version="2026.05.29", lifespan=lifespan)
```

to:

```python
app = FastAPI(title="虚拟患者训练系统", version=APP_VERSION, lifespan=lifespan)
```

- [ ] **Step 3: Verify backend starts correctly**

```bash
cd backend; if ($?) { uv run python -c "from main import app; print(app.version)" }
```

Expected output: `dev` (or whatever APP_VERSION is in local `.env`)

- [ ] **Step 4: Commit**

```bash
git add backend/main.py
git commit -m "refactor: wire FastAPI version to config.APP_VERSION"
```

---

### Task 6: Create frontend version access point

**Files:**
- Create: `frontend/src/version.js`

- [ ] **Step 1: Create version.js**

```js
export const APP_VERSION = import.meta.env.VITE_APP_VERSION || "dev";
```

- [ ] **Step 2: Verify during local dev server**

```bash
cd frontend; if ($?) { npx vite build 2>&1 | Select-String -Pattern "error" }
```

Expected: No errors. (Vite will inline `import.meta.env.VITE_APP_VERSION`; locally it resolves to `undefined`, falling back to `"dev"`.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/version.js
git commit -m "feat: add frontend version access point (import.meta.env.VITE_APP_VERSION)"
```

---

### Task 7: Remove APP_VERSION from .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Remove APP_VERSION line**

Remove line 5 (`APP_VERSION=1.17.0`) and the blank line 6 from `.env.example`.

The `# ===== 运行环境 =====` section becomes:

```
# ===== 运行环境 =====
# Python 版本: >=3.13 (由 pyproject.toml 和 .python-version 指定)
# 依赖管理: uv (pip 已废弃，见 backend/pyproject.toml)
ENV=development

# ===== 安全 =====
```

(Remove `APP_VERSION=1.17.0` and the empty line after it.)

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore: remove APP_VERSION from .env.example (now injected via Docker build arg)"
```

---

### Task 8: End-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Full local docker compose test**

```bash
docker compose build --build-arg APP_VERSION=dev --no-cache
```

Expected: Both backend and frontend build successfully.

- [ ] **Step 2: Verify backend health endpoint**

```bash
docker compose up -d db backend; curl -s http://localhost:8000/api/health
```

Expected: JSON containing `"version":"dev"`.

- [ ] **Step 3: Verify frontend contains version in JS bundle**

```bash
docker run --rm --entrypoint sh (docker compose images -q frontend) -c "grep -o 'dev' /usr/share/nginx/html/assets/*.js" | Select-Object -First 3
```

Expected: Shows matches for `"dev"` string in the bundle.

- [ ] **Step 4: Tear down**

```bash
docker compose down
```

- [ ] **Step 5: Commit if any follow-up fixes needed**

---
