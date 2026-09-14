"""Training tools — the only entry point for tool execution.

No tool is reachable except through ``dispatch(action, params, ctx)``.
Registration is explicit in ``register_all()``; there is no auto-discovery
or plugin scanning.

Tool contracts (centralised, one place each):
  - unknown tool / unknown ``action`` (handler's ``actions`` whitelist) →
    ``ValidationError`` (HTTP 400), never an audited "success";
  - ``record.user_id == ctx.current_user.id`` (auth — only own record),
    ``record.status == "in_progress"`` (lifecycle gate) and
    ``is_enabled(record, tool_name)`` (capability gate) are enforced once in
    ``service._authorize`` — handlers contain domain logic only;
  - all mutations happen inside the request-scoped DB session; no
    multi-transaction or detached commit in tool code;
  - idempotency: ``service.execute_tool_command`` replays the stored
    ``{data, scene}`` payload for a repeated ``idem_key``.
"""

from .base import ToolContext, ToolHandler, ToolResult
from .registry import dispatch, register, registry


def register_all():
    """Auto-discover and register all tool handlers."""
    from .nursing_diagnosis import NursingDiagnosisHandler
    from .nursing_record import NursingRecordHandler
    from .physical_exam import PhysicalExamHandler
    from .quiz import QuizHandler

    register(PhysicalExamHandler())
    register(NursingRecordHandler())
    register(QuizHandler())
    register(NursingDiagnosisHandler())


__all__ = ["ToolContext", "ToolHandler", "ToolResult", "dispatch", "register", "register_all", "registry"]
