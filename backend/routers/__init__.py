"""API router registration — ``register_routers(app)`` wires all routes into FastAPI."""

from fastapi import FastAPI


def register_routers(app: FastAPI) -> None:
    from modules.assignments import router as assignments
    from modules.auth import router as auth
    from modules.cases import router as cases
    from modules.feedback import router as feedback
    from modules.questionnaires import router as questionnaires

    # ── domain routers (flat module → .router, each manages its own prefix) ──
    from routers import (
        exports,
        rubrics,
        stats,
        student_assignments,
    )

    for mod in (assignments, auth, cases, feedback, exports, questionnaires, rubrics, stats, student_assignments):
        app.include_router(mod.router)

    # ── module routers expose APIRouter via __init__.py ──
    from modules.qa import router as qa_router
    from modules.training import (
        chat_router,
        training_router,
    )
    from routers import admin

    app.include_router(admin.router)
    app.include_router(qa_router)
    for r in (training_router, chat_router):
        app.include_router(r)

    # ── infrastructure routers (third-party integration endpoints) ──
    from infra.diagnostics import router as diagnostics_router
    from infra.telemetry import router as telemetry_router
    from modules.voice.router import router as tts_router
    from routers.profiles import router as profiles_router

    for r in (diagnostics_router, profiles_router, telemetry_router, tts_router):
        app.include_router(r)
