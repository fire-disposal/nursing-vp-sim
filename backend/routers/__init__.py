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
    from routers import auth, cases, feedback, notes, questionnaires, records, stats

    for mod in (auth, cases, feedback, notes, questionnaires, records, stats):
        app.include_router(mod.router)

    # ── composite + direct admin routers ──
    from routers import admin

    app.include_router(admin.router)

    from routers.admin.classes import router as _classes
    from routers.admin.costs import router as _costs
    from routers.admin.grades import router as _grades
    from routers.admin.practices import router as _practices
    from routers.admin.roles import router as _roles
    from routers.admin.secrets import router as _secrets
    from routers.admin.voice import router as _voice

    for r in (_classes, _costs, _grades, _practices, _roles, _secrets, _voice):
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
    from routers.health import router as _health
    from routers.students import router as _student_assignments
    from routers.tts import router as _tts

    for r in (_asr, _assignments, _student_assignments, _health, _tts):
        app.include_router(r)
