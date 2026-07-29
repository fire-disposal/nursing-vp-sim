"""API router registration — ``register_routers(app)`` wires all routes into FastAPI."""

from fastapi import FastAPI


def register_routers(app: FastAPI) -> None:
    from infra.diagnostics import router as diagnostics_router
    from infra.telemetry import router as telemetry_router
    from modules.admin import get_top_level_routers
    from modules.admin import router as admin_router
    from modules.assignments import router as assignments_router
    from modules.assignments import student_router as assignments_student_router
    from modules.auth.router import router as auth_router
    from modules.cases.router import router as cases_router
    from modules.feedback.router import router as feedback_router
    from modules.qa import router as qa_router
    from modules.questionnaires.router import router as questionnaires_router
    from modules.training import chat_router, training_router
    from modules.voice.router import router as tts_router

    exports_router, profiles_router, rubrics_router, stats_router = get_top_level_routers()
    for r in (
        admin_router,
        assignments_router,
        assignments_student_router,
        auth_router,
        cases_router,
        chat_router,
        diagnostics_router,
        exports_router,
        feedback_router,
        profiles_router,
        qa_router,
        questionnaires_router,
        rubrics_router,
        stats_router,
        telemetry_router,
        training_router,
        tts_router,
    ):
        app.include_router(r)
