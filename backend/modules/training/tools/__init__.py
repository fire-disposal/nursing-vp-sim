"""Training activities — domain handlers behind the Activity contract.

The handler table is a projection of ``modules.training.activities.ACTIVITY_BINDINGS``
(one instantiation per activity, no auto-discovery, no plugin scanning); commands are
reachable only through ``modules.training.tools.service.execute_tool_command``.

This package intentionally re-exports nothing: importing a submodule must not drag the
whole handler graph (``tools.physical_exam`` imports the Activity contract, so a
package-level ``from .registry import ...`` here would close an import cycle).

Contracts (centralised, one place each):
  - unknown activity / unknown ``command`` (handler's ``actions`` whitelist) →
    ``ValidationError`` (HTTP 400), never an audited "success";
  - ``record.user_id == ctx.current_user.id`` (auth — only own record),
    ``record.status == "in_progress"`` (lifecycle gate) and the server-resolved
    Activity availability (case declaration ∩ workflow whitelist ∩ overrides)
    are enforced once in ``service._authorize`` — handlers contain domain logic only;
  - all mutations happen inside the request-scoped DB session; no
    multi-transaction or detached commit in tool code;
  - ``runtime_state`` is a bare JSONB column with no change tracking: a handler
    that mutates nested structures MUST start from ``base.copy_runtime_state``
    (shallow ``dict(state)`` shares the nested objects, so an in-place
    ``append``/``update`` makes the ORM's stored old value change too and the
    flush writes nothing — the measurement silently never reaches the DB);
  - idempotency: ``service.execute_tool_command`` replays the stored
    ``{data, scene}`` payload for a repeated ``idem_key``.
"""
