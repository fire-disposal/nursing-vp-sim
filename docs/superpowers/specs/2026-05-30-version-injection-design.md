# Version Injection via CI/CD Build Args

## Goal

Eliminate hardcoded version strings in both backend and frontend. Instead, inject the version number from the git tag through Docker build arguments passed by CD workflow, so each deployed image knows its own version.

## Background

- CD is triggered by `v*` tags (e.g., `v2026.05.30`)
- `docker/metadata-action@v5` already extracts the tag into `steps.meta.outputs.version` (e.g., `"2026.05.30"`)
- Currently this version is used only for Docker image tags, not passed into the containers
- `config.py:13` has `APP_VERSION = os.getenv("APP_VERSION", "2026.05.29")` — hardcoded fallback
- `main.py:43` has `FastAPI(version="2026.05.29")` — hardcoded
- Frontend has no version awareness

## Data Flow

```
git tag v2026.05.30
    │
    ▼
deploy-production.yml: docker/metadata-action extracts → "2026.05.30"
    │
    ├─► docker build --build-arg APP_VERSION=2026.05.30 Dockerfile.backend
    │       │
    │       ▼
    │   ARG APP_VERSION=dev → ENV APP_VERSION=$APP_VERSION
    │       │
    │       ▼
    │   config.py → os.getenv("APP_VERSION") → "2026.05.30"
    │   main.py → FastAPI(version=config.APP_VERSION)
    │   GET /api/health → {"version": "2026.05.30"}
    │
    └─► docker build --build-arg APP_VERSION=2026.05.30 Dockerfile.frontend
            │
            ▼
        ARG APP_VERSION=dev → ENV VITE_APP_VERSION=$APP_VERSION
            │
            ▼
        Vite inlines import.meta.env.VITE_APP_VERSION at build time
            │
            ▼
        frontend/src/version.js → "2026.05.30"
```

## Changes

### 1. `Dockerfile.backend` — Accept build arg

```
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
```

Place before `COPY backend/ .` so `APP_VERSION` env var is available at runtime.

### 2. `Dockerfile.frontend` — Accept build arg

```
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=${APP_VERSION}
```

Place in the `builder` stage, before `RUN npm run build` (Vite reads `VITE_*` env vars at build time and inlines them).

### 3. `deploy-production.yml` — Pass build arg

Add `build-args: APP_VERSION=${{ steps.meta.outputs.version }}` to both `build-push-action` steps (backend + frontend).

### 4. `backend/config.py` — Change fallback

```python
APP_VERSION = os.getenv("APP_VERSION", "dev")
```

Replace `"2026.05.29"` with `"dev"` — local development without tag.

### 5. `backend/main.py` — Use config value

```python
from config import APP_VERSION
app = FastAPI(title="虚拟患者训练系统", version=APP_VERSION, lifespan=lifespan)
```

Replace hardcoded `"2026.05.29"` with `APP_VERSION`.

### 6. `frontend/src/version.js` — New file (version access point)

```js
export const APP_VERSION = import.meta.env.VITE_APP_VERSION || "dev";
```

Frontend components can import this to display the version.

## Verification

- **CD pipeline**: Push a `v*` tag, verify deployed `/api/health` returns the tag version
- **Local dev**: Run `docker compose build` without tag — health should return `"dev"`
- **Frontend**: After build, `APP_VERSION` in the bundle should match the tag

## What stays the same

- `.env.example` still contains `APP_VERSION=1.17.0` — used for local non-Docker dev
- No changes to `docker-compose.yml` local file needed
- No runtime performance impact — version is read once at startup
