"""Clinical Reasoning Simulation module (MVP-B).

A self-contained, business-isolated longitudinal slice: a single hidden
post-op bleeding case playable to good/delay outcomes. It shares only
infrastructure (DB, auth, exceptions, migrations, type generation) with the
main system — it does not touch the training/cases/qa domains or the main UI.

- ``case``: the single case definition and deterministic physiology.
- ``engine``: pure deterministic state machine (no DB/HTTP).
- ``service``: persistence + public-snapshot whitelist.
- ``router``: exposes ``/api/simulations``.

Scope-locked to MVP-B: no LLM, no DSL, no probabilistic course, no multi-case.
"""

from .router import router as simulations_router

__all__ = ["simulations_router"]
