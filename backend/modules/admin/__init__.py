"""Admin module — admin-namespace endpoints (under ``/api/admin``) plus
top-level teacher-facing routers (exports, stats, rubrics, profiles) that
carry their own absolute prefixes and are registered at app root.
"""

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

for r in (
    _classes,
    _costs,
    _grades,
    _llm_monitor,
    _ops,
    _roles,
    _secrets,
    _system_notifications,
    _users,
    _voice,
):
    router.include_router(r)

# ── top-level routers (own absolute prefixes, registered at app root) ──
from .exports import router as exports_router
from .profiles import router as profiles_router
from .rubrics import router as rubrics_router
from .stats import router as stats_router

__all__ = [
    "exports_router",
    "profiles_router",
    "router",
    "rubrics_router",
    "stats_router",
]
