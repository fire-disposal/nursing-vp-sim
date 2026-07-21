# Codebase Reorganization Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate structural inconsistencies (single-file directories, mis-categorized files, fragmented concerns) across backend and frontend without changing the layered architecture.

**Architecture:** Three incremental phases — each independently testable and mergeable. Phase 1 is pure flattening (remove empty/wasted directories). Phase 2 repatriates files to their correct layer. Phase 3 unifies registration patterns and moves shared data to proper homes.

**Tech Stack:** Python 3.13 + FastAPI + SQLAlchemy (backend), TypeScript + React + Vite (frontend)

---

## Pre-Flight Checklist (Before Any Phase)

- [ ] `git rev-parse --git-dir` confirms in repo
- [ ] `git config core.hooksPath` confirms `.husky/_`
- [ ] `git stash` or clean working tree
- [ ] `pnpm run check` passes on current state
- [ ] `cd backend; uv run python -m pytest -x -q` passes

---

## Phase 1: Flatten (Eliminate Single-File & Empty Directories)

**Risk: Very Low.** Only file moves within same parent directory or to sibling. No new dependencies, no cross-layer movement.

### Task 1.1: Flatten `middleware/rate_limits.py` → `core/rate_limits.py`

**Rationale:** A single-file directory provides zero organizational value. `rate_limits` is a cross-cutting concern that fits naturally in `core/` alongside `security.py` and `deps.py`.

**Files:**
- Move: `backend/middleware/rate_limits.py` → `backend/core/rate_limits.py`
- Delete: `backend/middleware/` directory (after confirming empty)
- Modify: 6 import sites

**Import changes required:**

| File | Old Import | New Import |
|------|-----------|------------|
| `backend/main.py:56` | `from middleware.rate_limits import PgRateLimiter` | `from core.rate_limits import PgRateLimiter` |
| `backend/routers/tts.py:14` | `from middleware.rate_limits import check_tts_limit` | `from core.rate_limits import check_tts_limit` |
| `backend/routers/auth.py:8` | `from middleware.rate_limits import login_rate_limit, register_rate_limit, reset_login_limit` | `from core.rate_limits import login_rate_limit, register_rate_limit, reset_login_limit` |
| `backend/tests/core/test_rate_limits.py:5` | `from middleware.rate_limits import PgRateLimiter` | `from core.rate_limits import PgRateLimiter` |
| `backend/contexts/qa/api.py:16` | `from middleware.rate_limits import check_qa_limit` | `from core.rate_limits import check_qa_limit` |
| `backend/contexts/training/router/chat.py:16` | `from middleware.rate_limits import check_chat_limit` | `from core.rate_limits import check_chat_limit` |

**Verification:**
```bash
cd backend; uv run python -m pytest tests/core/test_rate_limits.py -x -q
```

---

### Task 1.2: Flatten `core/login_strategies/` → `core/login_strategies.py`

**Rationale:** 1 substantive file (`password.py`) + `__init__.py` that mixes ABC definition with package bootstrap. The "strategies" pattern is premature for a single implementation. Flatten to one module with ABC + PasswordLoginStrategy in the same file.

**Files:**
- Create: `backend/core/login_strategies.py` — merge content of `__init__.py` + `password.py`
- Delete: `backend/core/login_strategies/__init__.py`
- Delete: `backend/core/login_strategies/password.py`
- Delete: `backend/core/login_strategies/` directory
- Modify: 2 import sites

**New file content (`backend/core/login_strategies.py`):**
```python
"""Login strategy abstraction — ABC + built-in Password strategy.

To add a new strategy:
1. Subclass LoginStrategy
2. Implement authenticate()
3. Register via get_strategy_registry()["key"] = YourStrategy()
"""

from abc import ABC, abstractmethod
from typing import Any

from sqlalchemy.orm import Session

from core.security import verify_password


class LoginStrategy(ABC):
    """Authenticate a user via a specific method (password, OAuth, etc.)."""

    @abstractmethod
    def authenticate(self, db: Session, login_identifier: str, credential: str | None = None, **kwargs: Any) -> Any:
        """Return (user, optional_error_message). Raise AuthError on failure."""
        ...


class PasswordLoginStrategy(LoginStrategy):
    """Authenticate by checking password against the stored hash."""

    def authenticate(self, db: Session, login_identifier: str, credential: str | None = None, **kwargs: Any) -> Any:
        password = credential if credential is not None else kwargs.get("password", "")
        from repositories.user import UserRepository
        repo = UserRepository(db)
        user = repo.get_by_username(login_identifier)
        if not user or not verify_password(password, user.hashed_password):
            from core.exceptions import AuthError
            raise AuthError("用户名或密码错误")
        return user


# Registry of available login strategies. Key used by POST /auth/login's strategy field.
LOGIN_STRATEGIES: dict[str, LoginStrategy] = {
    "password": PasswordLoginStrategy(),
}


def get_strategy_registry() -> dict[str, LoginStrategy]:
    return LOGIN_STRATEGIES
```

**Import changes:**

| File | Old Import | New Import |
|------|-----------|------------|
| `backend/services/auth.py:7` | `from core.login_strategies import get_strategy_registry` | `from core.login_strategies import get_strategy_registry` (unchanged!) |
| `backend/core/login_strategies.py` (new) | n/a | Internal: imports `repositories.user`, `core.security`, `core.exceptions` |

> **Note:** The import in `services/auth.py` happens to already use `from core.login_strategies import ...` which Python resolves to the package `__init__.py`. After flattening, it resolves to the module. **The import statement in callers does NOT change.**

**Verification:**
```bash
cd backend; uv run python -m pytest tests/auth/ -x -q
```

---

### Task 1.3: Flatten `contexts/training/scene/state.py` → `contexts/training/scene_state.py`

**Rationale:** Single file (`state.py`, 87 lines) + empty `__init__.py`. The subdirectory is unjustified.

**Files:**
- Move: `backend/contexts/training/scene/state.py` → `backend/contexts/training/scene_state.py`
- Delete: `backend/contexts/training/scene/__init__.py`
- Delete: `backend/contexts/training/scene/` directory
- Modify: 1 import site

**Import change:**

| File | Old Import | New Import |
|------|-----------|------------|
| `backend/contexts/training/pipeline/middleware/prompt_builder.py:14` | `from contexts.training.scene.state import (...)` | `from contexts.training.scene_state import (...)` |

**Verification:**
```bash
cd backend; uv run python -m pytest tests/scene/ -x -q
```

---

### Task 1.4: Add missing `infrastructure/rag/__init__.py`

**Rationale:** `infrastructure/rag/` has no `__init__.py`, making it an implicit namespace package. This works but is unconventional and fragile across Python versions.

**Files:**
- Create: `backend/infrastructure/rag/__init__.py`

**Content:**
```python
"""RAG (Retrieval-Augmented Generation) utilities — textbook indexing and chapter search."""
```

**Verification:**
```bash
cd backend; uv run python -c "from infrastructure.rag.indexer import check_indexed; print('OK')"
```

---

### Task 1.5: Populate empty `contexts/case_generation/__init__.py`

**Files:**
- Modify: `backend/contexts/case_generation/__init__.py`

**Content:**
```python
"""Case generation — LLM-powered case content generation prompts and service."""
```

---

### Task 1.6 (Frontend): Flatten `panels/triage/MewsPanel.tsx` → `panels/MewsPanel.tsx`

**Rationale:** 1 file in a subdirectory while sibling `scoring-display/` has 2 files.

**Files:**
- Move: `frontend/src/components/training/panels/triage/MewsPanel.tsx` → `frontend/src/components/training/panels/MewsPanel.tsx`
- Delete: `frontend/src/components/training/panels/triage/` directory
- Modify: 1 import site

**Import change:**

| File | Old Import | New Import |
|------|-----------|------------|
| `frontend/src/components/training/scene-cards/registry.ts:30` | `def("mews", () => import("@/components/training/panels/triage/MewsPanel"), ...)` | `def("mews", () => import("@/components/training/panels/MewsPanel"), ...)` |

**Verification:**
```bash
cd frontend; npx tsc --noEmit
```

---

### Task 1.7 (Frontend): Flatten `showcase/lib/gsap.ts` → `showcase/gsap.ts`

**Files:**
- Move: `frontend/src/showcase/lib/gsap.ts` → `frontend/src/showcase/gsap.ts`
- Delete: `frontend/src/showcase/lib/` directory
- Check: grep for any imports referencing `showcase/lib` (result: 0 occurrences found, no changes needed)

**Verification:**
```bash
cd frontend; npx tsc --noEmit
```

---

### Phase 1 Completion Verification

```bash
# Backend
cd backend; uv run python -m compileall -q .
cd backend; uv run python -m pytest -x -q
cd backend; uv run ruff check

# Frontend
cd frontend; npx tsc --noEmit
cd frontend; npx biome check

# Full
pnpm run check
```

---

## Phase 2: Repatriate (Move Mis-Categorized Files to Correct Layer)

**Risk: Medium.** Files move across top-level directories. Import paths change in multiple consumers. Run `pnpm run check` after each task.

### Task 2.1: Move `core/seed.py` → `scripts/seed.py`

**Rationale:** `core/` should contain cross-cutting framework code (config, db, security, exceptions). A database seed script that runs once at startup is an operational script, not core infrastructure.

**Files:**
- Move: `backend/core/seed.py` → `backend/scripts/seed.py`
- Modify: 1 import site

| File | Old Import | New Import |
|------|-----------|------------|
| `backend/main.py:48` | `from core.seed import seed_all` | `from scripts.seed import seed_all` |

**Verification:**
```bash
cd backend; uv run python -c "from scripts.seed import seed_all; print('OK')"
```

---

### Task 2.2: Move `core/logging_setup.py` → `infrastructure/logging_setup.py`

**Rationale:** Logging configuration is infrastructure, not core framework.

**Files:**
- Move: `backend/core/logging_setup.py` → `backend/infrastructure/logging_setup.py`
- Modify: 1 import site

| File | Old Import | New Import |
|------|-----------|------------|
| `backend/main.py:47` | `from core.logging_setup import setup_logging` | `from infrastructure.logging_setup import setup_logging` |

**Verification:**
```bash
cd backend; uv run python -c "from infrastructure.logging_setup import setup_logging; print('OK')"
```

---

### Task 2.3: Move `core/llm_profile.py` → `infrastructure/llm/profile.py`

**Rationale:** LLM profile configuration (model selection, thinking toggle) is an LLM infrastructure concern, not core framework.

**Files:**
- Move: `backend/core/llm_profile.py` → `backend/infrastructure/llm/profile.py`
- Modify: 9 import sites

| File | Old Import | New Import |
|------|-----------|------------|
| `backend/core/seed.py` → `scripts/seed.py:255` | `from core.llm_profile import PROFILES` | `from infrastructure.llm.profile import PROFILES` |
| `backend/contexts/training/score_engine.py:12` | `from core.llm_profile import get_enable_thinking, get_llm_config` | `from infrastructure.llm.profile import get_enable_thinking, get_llm_config` |
| `backend/profiles/history_taking/initiative.py:16` | `from core.llm_profile import get_llm_config` | `from infrastructure.llm.profile import get_llm_config` |
| `backend/infrastructure/llm/client.py:82` | `from core.llm_profile import PROFILES` | `from infrastructure.llm.profile import PROFILES` |
| `backend/infrastructure/llm/client.py:549` | `from core.llm_profile import get_model` | `from infrastructure.llm.profile import get_model` |
| `backend/contexts/case_generation/service.py:20` | `from core.llm_profile import get_llm_config` | `from infrastructure.llm.profile import get_llm_config` |
| `backend/contexts/training/pipeline/middleware/llm_caller.py:44` | `from core.llm_profile import get_llm_config` | `from infrastructure.llm.profile import get_llm_config` |
| `backend/contexts/training/pipeline/middleware/llm_caller.py:111` | `from core.llm_profile import get_llm_config` | `from infrastructure.llm.profile import get_llm_config` |
| `backend/infrastructure/llm/router.py:189` | `from core.llm_profile import get_model` | `from infrastructure.llm.profile import get_model` |
| `backend/contexts/qa/api.py:12` | `from core.llm_profile import get_llm_config` | `from infrastructure.llm.profile import get_llm_config` |

**Verification:**
```bash
cd backend; uv run python -m pytest tests/ -x -q -k "llm or scoring"
```

---

### Task 2.4: Move `core/capabilities.py` → `infrastructure/llm/capabilities.py`

**Rationale:** Capability flags control LLM feature toggles. This is LLM infrastructure, not core.

**Files:**
- Move: `backend/core/capabilities.py` → `backend/infrastructure/llm/capabilities.py`
- Modify: 7 import sites

| File | Old Import | New Import |
|------|-----------|------------|
| `backend/scripts/gen_capabilities_ts.py:19` | `from core.capabilities import ALL_CAPABILITIES, capabilities_for_type` | `from infrastructure.llm.capabilities import ALL_CAPABILITIES, capabilities_for_type` |
| `backend/services/physical_exam.py:7` | `from core.capabilities import is_enabled` | `from infrastructure.llm.capabilities import is_enabled` |
| `backend/tests/core/test_capabilities.py:3` | `from core.capabilities import (...)` | `from infrastructure.llm.capabilities import (...)` |
| `backend/contexts/training/router/scoring.py:417` | `from core.capabilities import resolve_features` | `from infrastructure.llm.capabilities import resolve_features` |
| `backend/contexts/training/router/chat.py:12` | `from core.capabilities import resolve_features` | `from infrastructure.llm.capabilities import resolve_features` |
| `backend/contexts/training/router/progress.py:7` | `from core.capabilities import is_enabled` | `from infrastructure.llm.capabilities import is_enabled` |
| `backend/contexts/training/router/session.py:12` | `from core.capabilities import resolve_features` | `from infrastructure.llm.capabilities import resolve_features` |

**Verification:**
```bash
cd backend; uv run python -m pytest tests/core/test_capabilities.py -x -q
```

---

### Task 2.5: Move `core/case_schema.py` → `schemas/case_schema.py`

**Rationale:** `case_schema.py` defines JSON schema validation for case data — it's a domain schema, not core framework. `core/` should only contain cross-cutting infrastructure.

**Files:**
- Move: `backend/core/case_schema.py` → `backend/schemas/case_schema.py`
- Modify: 7 import sites

| File | Old Import | New Import |
|------|-----------|------------|
| `backend/services/case.py:7` | `from core.case_schema import normalize_gender, validate_case_data` | `from schemas.case_schema import normalize_gender, validate_case_data` |
| `backend/schemas/case.py:6` | `from core.case_schema import CaseDataSchema` | `from schemas.case_schema import CaseDataSchema` |
| `backend/tests/case_generation/test_types.py:1` | `from core.case_schema import list_valid_training_types` | `from schemas.case_schema import list_valid_training_types` |
| `backend/tests/cases/test_case_schema.py:6` | `from core.case_schema import (...)` | `from schemas.case_schema import (...)` |
| `backend/contexts/training/router/session.py:13` | `from core.case_schema import normalize_gender, validate_case_data` | `from schemas.case_schema import normalize_gender, validate_case_data` |
| `backend/contexts/case_generation/service.py:10` | `from core.case_schema import list_valid_training_types, validate_case_data` | `from schemas.case_schema import list_valid_training_types, validate_case_data` |

**Verification:**
```bash
cd backend; uv run python -m pytest tests/cases/ -x -q
```

---

### Task 2.6: Move `core/diagnose.py` → `infrastructure/diagnose.py`

**Rationale:** The diagnose endpoint aggregates infrastructure metrics (LLM, scoring, voice, TTS). It's an infrastructure monitoring tool, not core framework.

**Files:**
- Move: `backend/core/diagnose.py` → `backend/infrastructure/diagnose.py`
- Modify: 3 import sites

| File | Old Import | New Import |
|------|-----------|------------|
| `backend/routers/health.py:20` | `from core.diagnose import get_diagnose_service` | `from infrastructure.diagnose import get_diagnose_service` |
| `backend/routers/admin/ops.py:17` | `from core.diagnose import get_diagnose_service` | `from infrastructure.diagnose import get_diagnose_service` |
| `backend/main.py:32` | `from core.diagnose import get_diagnose_service` | `from infrastructure.diagnose import get_diagnose_service` |

**Verification:**
```bash
cd backend; uv run python -c "from infrastructure.diagnose import get_diagnose_service; print('OK')"
```

---

### Task 2.7: Move `contexts/patient/` → `infrastructure/patient_ai/`

**Rationale:** The directory name `patient/` suggests a patient domain entity, but its content (note_collector, note_source, prompt, build_patient_chat_messages) is pure AI prompt infrastructure used by training profiles. It's not patient business logic. Rename to `patient_ai/` and relocate to `infrastructure/` where it conceptually belongs.

**Files:**
- Move: `backend/contexts/patient/note_collector.py` → `backend/infrastructure/patient_ai/note_collector.py`
- Move: `backend/contexts/patient/note_source.py` → `backend/infrastructure/patient_ai/note_source.py`
- Move: `backend/contexts/patient/prompt.py` → `backend/infrastructure/patient_ai/prompt.py`
- Move: `backend/contexts/patient/__init__.py` → `backend/infrastructure/patient_ai/__init__.py` (update internal imports)
- Delete: `backend/contexts/patient/` directory
- Create: `backend/infrastructure/patient_ai/__init__.py` (if moved cleanly, reuse existing)

**`__init__.py` internal changes:**
```python
# Old (contexts/patient/__init__.py):
from .note_source import NoteSource, OperationNoteSource
from .prompt import build_patient_chat_messages

# New (infrastructure/patient_ai/__init__.py):
from infrastructure.patient_ai.note_source import NoteSource, OperationNoteSource
from infrastructure.patient_ai.prompt import build_patient_chat_messages
```

**Import changes (12 sites):**

| File | Old Import | New Import |
|------|-----------|------------|
| `backend/profiles/registry.py:7` | `from contexts.patient.note_source import NoteSource` | `from infrastructure.patient_ai import NoteSource` |
| `backend/profiles/triage/profile.py:3` | `from contexts.patient.note_source import OperationNoteSource` | `from infrastructure.patient_ai import OperationNoteSource` |
| `backend/tests/training/test_virtual_patient_prompt.py:5` | `from contexts.patient import build_patient_chat_messages` | `from infrastructure.patient_ai import build_patient_chat_messages` |
| `backend/profiles/history_taking/profile.py:3` | `from contexts.patient.note_source import OperationNoteSource` | `from infrastructure.patient_ai import OperationNoteSource` |
| `backend/profiles/history_taking/notes.py:11` | `from contexts.patient.note_source import NoteSource` | `from infrastructure.patient_ai import NoteSource` |
| `backend/profiles/history_taking/builder.py:10` | `from contexts.patient.prompt import AUTHOR_NOTE_TEMPLATE` | `from infrastructure.patient_ai.prompt import AUTHOR_NOTE_TEMPLATE` |
| `backend/tests/training/test_patient_sources.py:3` | `from contexts.patient.note_source import OperationNoteSource` | `from infrastructure.patient_ai.note_source import OperationNoteSource` |
| `backend/tests/core/test_note_collector.py:5` | `from contexts.patient.note_collector import (...)` | `from infrastructure.patient_ai.note_collector import (...)` |
| `backend/tests/core/test_note_collector.py:9` | `from contexts.patient.note_source import NoteSource` | `from infrastructure.patient_ai.note_source import NoteSource` |
| `backend/contexts/training/pipeline/builder.py:36` | `from contexts.patient.note_collector import NoteCollector` | `from infrastructure.patient_ai.note_collector import NoteCollector` |
| `backend/contexts/training/pipeline/builder.py:47` | `from contexts.patient.note_source import OperationNoteSource` | `from infrastructure.patient_ai.note_source import OperationNoteSource` |
| `backend/contexts/training/pipeline/middleware/prompt_builder.py:13` | `from contexts.patient import build_patient_chat_messages` | `from infrastructure.patient_ai import build_patient_chat_messages` |

**Verification:**
```bash
cd backend; uv run python -m pytest tests/training/test_virtual_patient_prompt.py tests/training/test_patient_sources.py tests/core/test_note_collector.py -x -q
```

---

### Task 2.8: Split `contexts/case_generation/` into layers

**Rationale:** `case_generation` is too thin (2 files) to justify a domain context. `prompts.py` is LLM prompt text → belongs in `infrastructure/llm/prompts/`. `service.py` is a simple generation service → belongs in `services/case_generation.py`.

**Files:**
- Move: `backend/contexts/case_generation/prompts.py` → `backend/infrastructure/llm/prompts/case_generation.py`
- Move: `backend/contexts/case_generation/service.py` → `backend/services/case_generation.py` (update internal import)
- Delete: `backend/contexts/case_generation/__init__.py`
- Delete: `backend/contexts/case_generation/` directory
- Modify: 1 import site

**`services/case_generation.py` internal change:**
```python
# Old:
from contexts.case_generation.prompts import ...
# New:
from infrastructure.llm.prompts.case_generation import ...
```

| File | Old Import | New Import |
|------|-----------|------------|
| `backend/routers/cases.py:7` | `from contexts.case_generation.service import generate_case as _generate_case` | `from services.case_generation import generate_case as _generate_case` |

**Verification:**
```bash
cd backend; uv run python -m pytest tests/case_generation/ -x -q
```

---

### Task 2.9 (Frontend): Merge `training/` into `components/training/`

**Rationale:** `training/` (types.ts + scenes/) is a thin top-level directory that semantically belongs with the training UI components. Merge to eliminate one top-level directory.

**Files:**
- Move: `frontend/src/training/types.ts` → `frontend/src/components/training/types.ts`
- Move: `frontend/src/training/scenes/scene-registry.ts` → `frontend/src/components/training/scenes/scene-registry.ts`
- Move: `frontend/src/training/scenes/HistoryTakingScene.tsx` → `frontend/src/components/training/scenes/HistoryTakingScene.tsx`
- Move: `frontend/src/training/scenes/TriageScene.tsx` → `frontend/src/components/training/scenes/TriageScene.tsx`
- Delete: `frontend/src/training/` directory
- Modify: 3 import sites

| File | Old Import | New Import |
|------|-----------|------------|
| `frontend/src/api/training.ts:1` | `import type { TrainingTypeInfo } from "@/training/types"` | `import type { TrainingTypeInfo } from "@/components/training/types"` |
| `frontend/src/components/training/TrainingConfigSheet.tsx:6` | `import type { TrainingTypeInfo } from "@/training/types"` | `import type { TrainingTypeInfo } from "@/components/training/types"` |
| `frontend/src/pages/TrainingEntry.tsx:9` | `import { TRAINING_SCENES } from "../training/scenes/scene-registry"` | `import { TRAINING_SCENES } from "@/components/training/scenes/scene-registry"` |

**Verification:**
```bash
cd frontend; npx tsc --noEmit
```

---

### Task 2.10 (Frontend): Move `config/navigation.tsx` to `components/shell/navigation.tsx`

**Rationale:** `navigation.tsx` is a React component (renders navigation items), not a config file. `config/` should contain only runtime configuration data, not UI components.

**Files:**
- Move: `frontend/src/config/navigation.tsx` → `frontend/src/components/shell/navigation.tsx`
- Modify: 5 import sites

| File | Old Import | New Import |
|------|-----------|------------|
| `frontend/src/App.tsx:17` | `import { APP_ROUTES } from "@/config/navigation"` | `import { APP_ROUTES } from "@/components/shell/navigation"` |
| `frontend/src/components/Layout.tsx:23` | `import type { NavItem } from "@/config/navigation"` | `import type { NavItem } from "@/components/shell/navigation"` |
| `frontend/src/components/Layout.tsx:24` | `import { NAV_ITEMS } from "@/config/navigation"` | `import { NAV_ITEMS } from "@/components/shell/navigation"` |
| `frontend/src/components/shell/StudentTabShell.tsx:38` | `import type { NavItem } from "@/config/navigation"` | `import type { NavItem } from "@/components/shell/navigation"` |
| `frontend/src/components/shell/StudentTabShell.tsx:39` | `import { NAV_ITEMS } from "@/config/navigation"` | `import { NAV_ITEMS } from "@/components/shell/navigation"` |

**Verification:**
```bash
cd frontend; npx tsc --noEmit
```

---

### Phase 2 Completion Verification

```bash
# Backend — full check
cd backend; uv run python -m compileall -q .
cd backend; uv run python -m pytest -x -q
cd backend; uv run ruff check

# Frontend — type check + lint
cd frontend; npx tsc --noEmit
cd frontend; npx biome check

# Full
pnpm run check
```

---

## Phase 3: Polish (Unify Registration, Move Shared Data, Fix BARREL)

**Risk: Medium-Low.** Structural changes to router registration and barrel exports. No new dependencies introduced.

### Task 3.1: Unify admin router registration

**Rationale:** Currently 4 admin sub-routers are composed in `routers/admin/__init__.py`, and 6 are individually registered in `routers/__init__.py`. All 10 should go through the composite router for consistency.

**Files:**
- Modify: `backend/routers/admin/__init__.py` — add 6 more sub-router imports
- Modify: `backend/routers/__init__.py` — remove 6 direct admin imports

**Old `routers/admin/__init__.py`:**
```python
from fastapi import APIRouter

router = APIRouter(prefix="/api/admin", tags=["管理"])

from .llm_monitor import router as _llm_monitor
from .ops import router as _ops
from .system_notifications import router as _system_notifications
from .users import router as _users

for r in (_llm_monitor, _ops, _system_notifications, _users):
    router.include_router(r)
```

**New `routers/admin/__init__.py`:**
```python
from fastapi import APIRouter

router = APIRouter(prefix="/api/admin", tags=["管理"])

from .classes import router as _classes
from .costs import router as _costs
from .grades import router as _grades
from .llm_monitor import router as _llm_monitor
from .ops import router as _ops
from .roles import router as _roles
from .secrets import router as _secrets
from .system_notifications import router as _system_notifications
from .users import router as _users
from .voice import router as _voice

for r in (_classes, _costs, _grades, _llm_monitor, _ops, _roles, _secrets, _system_notifications, _users, _voice):
    router.include_router(r)
```

**Old `routers/__init__.py` (lines 27-36):**
```python
    from routers.admin.classes import router as _classes
    from routers.admin.costs import router as _costs
    from routers.admin.grades import router as _grades
    from routers.admin.roles import router as _roles
    from routers.admin.secrets import router as _secrets
    from routers.admin.voice import router as _voice

    for r in (_classes, _costs, _grades, _roles, _secrets, _voice):
        app.include_router(r)
```

**New `routers/__init__.py` (lines 27-28):**
```python
    # All admin sub-routers are now composed in routers/admin/__init__.py
    # The single admin.include_router(admin.router) above handles them all.
```

(Remove the 8-line block entirely — it's replaced by the existing `app.include_router(admin.router)` on line 26.)

**Verification:**
```bash
cd backend; uv run python -c "
from main import app
routes = [r.path for r in app.routes if hasattr(r, 'path')]
admin_routes = [r for r in routes if r.startswith('/api/admin')]
print(f'Admin routes: {len(admin_routes)}')
assert len(admin_routes) > 20, f'Expected >20 admin routes, got {len(admin_routes)}'
print('OK')
"
```

---

### Task 3.2: Move `prompts/` → `infrastructure/llm/prompts/`

**Rationale:** `prompts/` is a top-level directory containing only LLM prompt string constants. It belongs under `infrastructure/llm/`.

**Files:**
- Move: `backend/prompts/__init__.py` → `backend/infrastructure/llm/prompts/__init__.py` (update internal imports)
- Move: `backend/prompts/initiative.py` → `backend/infrastructure/llm/prompts/initiative.py`
- Move: `backend/prompts/patient_dynamic.py` → `backend/infrastructure/llm/prompts/patient_dynamic.py`
- Move: `backend/prompts/qa.py` → `backend/infrastructure/llm/prompts/qa.py`
- Move: `backend/prompts/scoring.py` → `backend/infrastructure/llm/prompts/scoring.py`
- Delete: `backend/prompts/` directory (after confirming empty)
- Modify: 13 import sites

**`__init__.py` internal changes:** All `from prompts.X import Y` → `from infrastructure.llm.prompts.X import Y`

**Import changes (13 sites):**

| File | Old Import | New Import |
|------|-----------|------------|
| `backend/contexts/training/score_engine.py:18-25` | `from prompts.scoring import (...)` | `from infrastructure.llm.prompts.scoring import (...)` |
| `backend/infrastructure/llm/prompts/__init__.py` | `from prompts.* import ...` | `from infrastructure.llm.prompts.* import ...` |
| `backend/profiles/history_taking/initiative.py:20` | `from prompts.initiative import INITIATIVE_SYSTEM, INITIATIVE_SYSTEM_SHORT` | `from infrastructure.llm.prompts.initiative import INITIATIVE_SYSTEM, INITIATIVE_SYSTEM_SHORT` |
| `backend/tests/scoring/test_scoring_integration.py:85` | `from prompts import SCORING_SYSTEM` | `from infrastructure.llm.prompts import SCORING_SYSTEM` |
| `backend/tests/scoring/test_scoring_integration.py:93` | `from prompts import SCORING_USER` | `from infrastructure.llm.prompts import SCORING_USER` |
| `backend/tests/scoring/test_scoring_integration.py:159` | `from prompts import SCORING_SYSTEM` | `from infrastructure.llm.prompts import SCORING_SYSTEM` |
| `backend/tests/scoring/test_scoring_integration.py:291` | `from prompts import (...)` | `from infrastructure.llm.prompts import (...)` |
| `backend/tests/scoring/test_scoring_integration.py:391` | `from prompts import SCORING_SYSTEM` | `from infrastructure.llm.prompts import SCORING_SYSTEM` |
| `backend/contexts/training/pipeline/middleware/prompt_builder.py:20` | `from prompts.patient_dynamic import PATIENT_DYNAMIC_TEMPLATE` | `from infrastructure.llm.prompts.patient_dynamic import PATIENT_DYNAMIC_TEMPLATE` |
| `backend/contexts/qa/api.py:18` | `from prompts import QA_SYSTEM` | `from infrastructure.llm.prompts import QA_SYSTEM` |

**Verification:**
```bash
cd backend; uv run python -m pytest tests/scoring/ -x -q
```

---

### Task 3.3: Keep `profiles/` in place (DO NOT MOVE)

**Rationale:** `profiles/` has 47 import references across all layers (schemas, services, routers, core, infrastructure, contexts). It is genuinely cross-cutting domain data used by the training pipeline AND by schema validation AND by service logic. Moving it would create tight coupling to a single domain. For now, treat it as **shared domain configuration** — similar to how `models/` is shared ORM definitions.

**Decision: Skip.** Revisit if training profiles grow >50 files or if a clear primary consumer emerges.

---

### Task 3.4 (Frontend): Fix `schemas/index.ts` barrel export

**Rationale:** Only `auth` and `case` schemas are re-exported. The barrel should export all domain schemas or none at all.

**Files:**
- Modify: `frontend/src/schemas/index.ts`

**Read current file first, then update to:**
```typescript
export * from "./auth";
export * from "./case";
export * from "./practice";
export * from "./assignment";
export * from "./grade-class";
export * from "./role";
export * from "./profile";
export * from "./secret";
export * from "./notification";
export * from "./llm-config";
```

**Verification:**
```bash
cd frontend; npx tsc --noEmit
```

---

### Task 3.5: Update AGENTS.md references

**Rationale:** `AGENTS.md` references `plugins/` but the directory doesn't exist. Update to reflect actual paths after Phase 2.

**Files:**
- Modify: `AGENTS.md`

**Change:**
```markdown
# Old:
frontend/src/plugins/       — 训练 UI 插件 (emotion, inquiry, nursing-record, physical-exam 等)

# New:
frontend/src/components/training/scene-cards/  — 训练场景卡片 (InquiryCard, NursingRecordCard, PhysicalAssessmentCard 等)
frontend/src/components/training/              — 训练 UI 组件 (ChatArea, EmotionIndicator, ExamCard 等)
```

---

### Phase 3 Completion Verification

```bash
# Full backend
cd backend; uv run python -m compileall -q .
cd backend; uv run python -m pytest -x -q
cd backend; uv run ruff check
cd backend; uv run ty check

# Full frontend
cd frontend; npx tsc --noEmit
cd frontend; npx biome check

# Monorepo check
pnpm run check
```

---

## Final State: Directory Map After All Three Phases

### Backend

```
backend/
├── core/                     # ~9 files: config, db, deps, exceptions, security, uow, pagination,
│   │                        #           datetime_utils, jsonb, permissions, rate_limits,
│   │                        #           login_strategies.py (was package), roles.py
│   ├── config.py
│   ├── database.py
│   ├── deps.py
│   ├── exceptions.py
│   ├── jsonb.py
│   ├── login_strategies.py  # ← was core/login_strategies/ package
│   ├── pagination.py
│   ├── permissions.py
│   ├── rate_limits.py       # ← was middleware/rate_limits.py
│   ├── roles.py
│   ├── security.py
│   ├── datetime_utils.py
│   └── unit_of_work.py
│
├── routers/                  # unchanged structure, unified admin registration
│   ├── __init__.py           # ← cleaned up: admin sub-routers removed
│   ├── admin/
│   │   └── __init__.py       # ← now composes all 10 admin sub-routers
│   ├── ...
│
├── services/                 # +1: case_generation.py added
│   ├── case_generation.py    # ← was contexts/case_generation/service.py
│   ├── ...
│
├── schemas/                  # +1: case_schema.py added
│   ├── case_schema.py        # ← was core/case_schema.py
│   ├── ...
│
├── models/                   # unchanged
├── repositories/             # unchanged
│
├── contexts/                 # reduced: only training + qa remain
│   ├── training/             # scene/ flattened to scene_state.py
│   │   ├── __init__.py
│   │   ├── scene_state.py   # ← was scenes/state.py
│   │   ├── ...
│   └── qa/
│       ├── ...
│
├── infrastructure/
│   ├── __init__.py
│   ├── diagnose.py           # ← was core/diagnose.py
│   ├── logging_setup.py      # ← was core/logging_setup.py
│   ├── cache.py
│   ├── exporter.py
│   ├── metrics.py
│   ├── ops_queries.py
│   ├── queue.py
│   ├── realtime_hub.py
│   ├── scoring_progress.py
│   ├── settlement.py
│   ├── asr/
│   ├── llm/
│   │   ├── profile.py        # ← was core/llm_profile.py
│   │   ├── capabilities.py   # ← was core/capabilities.py
│   │   ├── prompts/          # ← was top-level prompts/
│   │   │   ├── __init__.py
│   │   │   ├── initiative.py
│   │   │   ├── patient_dynamic.py
│   │   │   ├── qa.py
│   │   │   ├── scoring.py
│   │   │   └── case_generation.py  # ← was contexts/case_generation/prompts.py
│   │   ├── client.py
│   │   ├── circuit.py
│   │   ├── crypto_utils.py
│   │   ├── logging.py
│   │   ├── parsing.py
│   │   ├── router.py
│   │   └── token_counter.py
│   ├── patient_ai/           # ← was contexts/patient/
│   │   ├── __init__.py
│   │   ├── note_collector.py
│   │   ├── note_source.py
│   │   └── prompt.py
│   ├── prompt/
│   ├── rag/
│   │   ├── __init__.py       # ← NEW
│   │   ├── chapter_index.py
│   │   └── indexer.py
│   ├── tts/
│   ├── volc/
│
├── profiles/                 # kept in place (cross-cutting shared data, 47 references)
├── scripts/
│   ├── seed.py               # ← was core/seed.py
│   ├── gen_capabilities_ts.py
│   └── gen_combined_checklist.mjs
├── tests/
├── main.py
├── alembic.ini
└── pyproject.toml
```

### Frontend

```
frontend/src/
├── api/                      # unchanged
├── components/
│   ├── training/             # ← absorbed training/ + triage/ flattened
│   │   ├── types.ts          # ← was training/types.ts
│   │   ├── scenes/           # ← was training/scenes/
│   │   │   ├── scene-registry.ts
│   │   │   ├── HistoryTakingScene.tsx
│   │   │   └── TriageScene.tsx
│   │   ├── panels/
│   │   │   ├── MewsPanel.tsx # ← was panels/triage/MewsPanel.tsx
│   │   │   ├── scoring-display/
│   │   │   │   ├── ScoreCard.tsx
│   │   │   │   ├── ScoringOverlay.tsx
│   │   │   │   └── index.ts
│   │   ├── scene-cards/      # unchanged
│   │   ├── ChatArea.tsx      # unchanged
│   │   └── ...
│   ├── shell/
│   │   ├── navigation.tsx    # ← was config/navigation.tsx
│   │   ├── DefaultShell.tsx
│   │   ├── ImmersiveShell.tsx
│   │   └── StudentTabShell.tsx
│   ├── ui/                   # unchanged
│   └── ...
├── config/
│   ├── llm-purposes.ts       # (navigation.tsx moved out)
│   └── permissions.gen.ts
├── showcase/
│   ├── gsap.ts               # ← was showcase/lib/gsap.ts
│   └── ...
├── schemas/
│   └── index.ts              # ← now exports ALL domain schemas
├── ... (hooks, stores, types, utils, engine unchanged)
```

---

## Post-Reorganization Verification Suite

After all three phases are complete, run the full gate:

```bash
# 1. Backend syntax + lint + type
cd backend; uv run python -m compileall -q .; uv run ruff check; uv run ruff format; uv run ty check

# 2. Backend tests
cd backend; uv run python -m pytest -x -q

# 3. Frontend type + lint
cd frontend; npx tsc --noEmit; npx biome check

# 4. Monorepo check
pnpm run check

# 5. API spec sync (per AGENTS.md requirement after any backend change)
pnpm run api:update
pnpm run check:api

# 6. Git hooks validation
git config core.hooksPath   # must be .husky/_
```

---

## Deleted Directories (After All Three Phases)

| Directory | Phase | Replacement |
|-----------|-------|-------------|
| `backend/middleware/` | 1 | `core/rate_limits.py` |
| `backend/core/login_strategies/` | 1 | `core/login_strategies.py` |
| `backend/contexts/training/scene/` | 1 | `contexts/training/scene_state.py` |
| `backend/prompts/` | 3 | `infrastructure/llm/prompts/` |
| `backend/contexts/patient/` | 2 | `infrastructure/patient_ai/` |
| `backend/contexts/case_generation/` | 2 | `services/case_generation.py` + `infrastructure/llm/prompts/case_generation.py` |
| `frontend/src/training/` | 2 | `components/training/` |
| `frontend/src/showcase/lib/` | 1 | `showcase/gsap.ts` |
| `frontend/src/components/training/panels/triage/` | 1 | `panels/MewsPanel.tsx` |

**Total: 9 directories eliminated.**
