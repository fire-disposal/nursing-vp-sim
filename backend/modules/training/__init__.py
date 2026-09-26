"""Training domain module.

Entry map:
- ``router`` exposes ``/api/training`` lifecycle, scoring, progress, and WS routes.
- ``router.chat`` exposes chat/SSE; the stream opens DB sessions only inside pipeline steps.
- ``pipeline`` runs prompt building → LLM call → must-succeed persistence → best-effort side effects.
- ``tools`` is the only tool authorization/idempotency/transaction entry.
- ``scoring`` owns scoring lifecycle and rubric validation.
- ``session`` owns emotion/initiative runtime caches and settlement state.

Do not add a second pipeline, event bus, plugin lifecycle, or training type registry here.

**本包不导入任何子模块**（曾经在这里 `from .router import router`）：包初始化一旦拉起
routers，任何 `modules.training.<anything>` 导入都会连带装配整个应用，把深层模块之间的
循环依赖从"局部"放大成"全局"（persister ↔ patient_ai.initiative ↔ workflows 的环就是被
它触发的）。路由挂载方（``main.py``）直接 `from modules.training.router import router`。
"""
