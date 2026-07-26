"""API router registration — ``register_routers(app)`` wires all routes into FastAPI."""

from fastapi import FastAPI


def register_routers(app: FastAPI) -> None:
    # ── domain routers (flat module → .router, each manages its own prefix) ──
    from routers import (
        assignments,
        auth,
        cases,
        exports,
        feedback,
        questionnaires,
        rubrics,
        stats,
        student_assignments,
    )

    for mod in (assignments, auth, cases, feedback, exports, questionnaires, rubrics, stats, student_assignments):
        app.include_router(mod.router)

    # ── composite routers (contexts expose a single APIRouter via __init__.py) ──
    from contexts.qa import router as qa_router
    from contexts.training import (
        chat_router,
        training_router,
    )
    from routers import admin

    app.include_router(admin.router)
    app.include_router(qa_router)
    for r in (training_router, chat_router):
        app.include_router(r)

    # ── infrastructure routers (third-party integration endpoints) ──
    from routers.health import router as health_router
    from routers.profiles import router as profiles_router
    from routers.telemetry import router as telemetry_router
    from routers.tts import router as tts_router

    for r in (health_router, profiles_router, telemetry_router, tts_router):
        app.include_router(r)
