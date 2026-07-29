"""Training domain module.

Entry map:
- ``router`` exposes ``/api/training`` lifecycle, scoring, progress, and WS routes.
- ``router.chat`` exposes chat/SSE; the stream opens DB sessions only inside pipeline steps.
- ``pipeline`` runs prompt building → LLM call → must-succeed persistence → best-effort side effects.
- ``tools`` is the only tool authorization/idempotency/transaction entry.
- ``scoring`` owns scoring lifecycle and rubric validation.
- ``session`` owns emotion/initiative runtime caches and settlement state.

Do not add a second pipeline, event bus, plugin lifecycle, or training type registry here.
"""

from .router import router as training_router
from .router.chat import router as chat_router

__all__ = ["chat_router", "training_router"]
