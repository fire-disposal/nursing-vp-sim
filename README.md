# nursing-vp-sim

Nursing Virtual Patient Simulator — LLM-powered medical history interview training platform.

## Overview

Students conduct simulated medical history interviews with LLM-driven virtual patients via natural language chat. The system automatically scores students on 19 criteria (100-point scale) with evidence-based feedback. Teachers can review and override AI scores, manage users/cases, and monitor LLM usage.

> **Version:** v2026.05.29 · **Status:** Production-ready

## Quick Start

```bash
# Backend (port 8000)
cd backend
uv sync
uv run uvicorn main:app --host 127.0.0.1 --port 8000 --reload

# Frontend (port 3000)
cd frontend
npm install
npm run dev
```

### Default Accounts

| Role    | Username  | Password  |
|---------|-----------|-----------|
| Teacher | admin     | admin123  |
| Student | student1~5 | 123456   |

## Tech Stack

| Layer    | Technology |
|----------|-----------|
| Backend  | Python 3.13 / FastAPI / SQLAlchemy 2.0 / SQLite WAL |
| Frontend | React 19 / Vite 8 / react-router-dom v7 / recharts |
| LLM      | DeepSeek Chat API (streaming SSE + JSON mode) |
| Auth     | JWT (python-jose) + bcrypt |
| Testing  | pytest (42) + Vitest (17) |
| CI/CD    | GitHub Actions → Docker → GHCR → VPS deploy |

## Key Features

- **LLM Virtual Patient** — Role-playing with hidden medical info gated by keyword detection
- **Auto Scoring** — 19-item rubric (14 communication + 5 history-taking), evidence-with-reason per item
- **Teacher Review** — Per-item score override + review comments + audit badge
- **Streaming Chat** — SSE streaming, <1s first token, typing indicator
- **Progress Sidebar** — Client-side keyword matching to track inquiry coverage
- **LLM Monitor** — Per-purpose cost/latency/error stats, training-level aggregation
- **Duration Stats** — Daily trends, cumulative minutes, student ranking
- **CSV Export** — Streaming export for training records
- **14 UI Components** — Design system with CSS variable tokens

## Project Structure

```
├── backend/           # FastAPI (routers/, services/, models.py, schemas.py)
├── frontend/          # React SPA (pages/, components/ui/, styles/)
├── docs/              # Architecture, API reference, database, frontend docs
├── .github/workflows/ # CI (test+build) + CD (Docker+deploy on v* tag)
├── docker-compose.yml
├── Dockerfile.backend / Dockerfile.frontend
└── nginx.conf
```

## Environment Variables

Copy `.env.example` to `.env` in project root:

```bash
# Required
DEEPSEEK_API_KEY=sk-your-key
SECRET_KEY=<random-32-char>

# Optional
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com
CORS_ORIGINS=http://localhost:3000,http://localhost:8000
DATABASE_URL=sqlite:///data.db
```

## Repo Secrets (GitHub Actions)

Required secrets for CI/CD pipeline:

| Secret            | Purpose                          |
|-------------------|----------------------------------|
| `DEEPSEEK_API_KEY`| LLM API key (used in .env)       |
| `SSH_HOST`        | VPS host for CD deploy           |
| `SSH_USER`        | VPS user for CD deploy           |
| `SSH_PRIVATE_KEY` | SSH key for deploy authentication |

## Commit Convention

Husky + commitlint enforces: `<emoji> <type>: <description>`

| Emoji | Type     |
|-------|----------|
| ✨     | feat     |
| 🐛     | fix      |
| 📝     | docs     |
| ♻️     | refactor |
| 🔧     | chore    |
| ✅     | test     |
| 💄     | style    |
| 🚀     | ci       |
| 📦     | build    |
| ⚡     | perf     |

Example: `✨ feat: add patient scoring module`

## Documentation

- [Architecture](docs/01-architecture.md)
- [API Reference](docs/02-api-reference.md)
- [Database](docs/03-database.md)
- [Frontend](docs/04-frontend.md)
- [LLM & Scoring](docs/05-llm-design.md)
- [Startup Guide](docs/07-startup-guide.md)

## License

MIT — original author consent for independent development.
