"""API routers — ``register_routers(app)`` wires all routes into the FastAPI app.

All imports are lazy (inside the function) to avoid circular imports between
``main`` and router modules.

Categories
----------
* **domain** — flat module with ``.router`` attribute, registered in batch.
* **composite** — ``admin/__init__.py`` composes sub-routers under a shared prefix.
* **direct** — modules whose router carries its own full prefix (no composition).
"""

from fastapi import FastAPI


def register_routers(app: FastAPI) -> None:
    # ── domain routers (flat module → .router) ──
    from routers import auth, cases, export, feedback, notes, questionnaires, stats

    for mod in (auth, cases, export, feedback, notes, questionnaires, stats):
        app.include_router(mod.router)

    # ── composite admin router (sub-routers via admin/__init__.py) ──
    from routers import admin

    app.include_router(admin.router)

    # ── admin routers with full prefix (registered directly) ──
    from routers.admin.api import router as _api
    from routers.admin.classes import router as _classes
    from routers.admin.grades import router as _grades
    from routers.admin.practices import router as _practices
    from routers.admin.prompts import router as _prompts
    from routers.admin.roles import router as _roles
    from routers.admin.voice import router as _voice

    for r in (_api, _classes, _grades, _practices, _prompts, _roles, _voice):
        app.include_router(r)

    # ── training context routers ──
    from contexts.training import chat_router, nursing_router, training_router

    for r in (training_router, chat_router, nursing_router):
        app.include_router(r)

    # ── QA context router ──
    from contexts.qa import router as qa_router

    app.include_router(qa_router)

    # ── utility / infra routers ──
    from routers.asr import router as _asr
    from routers.assignments import router as _assignments
    from routers.assignments import student_router as _student_assignments
    from routers.ops import router as _ops
    from routers.tts import router as _tts

    for r in (_asr, _assignments, _student_assignments, _ops, _tts):
        app.include_router(r)
