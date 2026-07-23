"""API router registration — ``register_routers(app)`` wires all routes into FastAPI."""

from fastapi import FastAPI


def register_routers(app: FastAPI) -> None:
    # ── domain routers (flat module → .router, each manages its own prefix) ──
    from routers import (
        assignments,
        auth,
        cases,
        feedback,
        questionnaires,
        records,
        rubrics,
        stats,
    )

    for mod in (assignments, auth, cases, feedback, questionnaires, records, rubrics, stats):
        app.include_router(mod.router)

    # ── composite routers (contexts expose a single APIRouter via __init__.py) ──
    from contexts.qa import router as qa_router
    from contexts.training import (
        chat_router,
        student_router,
        training_router,
    )
    from routers import admin

    app.include_router(admin.router)
    app.include_router(qa_router)
    for r in (training_router, chat_router, student_router):
        app.include_router(r)

    # ── infrastructure routers (third-party integration endpoints) ──
    from routers.asr import router as asr_router
    from routers.health import router as health_router
    from routers.profiles import router as profiles_router
    from routers.tts import router as tts_router

    for r in (asr_router, health_router, profiles_router, tts_router):
        app.include_router(r)
