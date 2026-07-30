"""Training tools — the only entry point for tool execution.

No tool is reachable except through ``dispatch(action, params, ctx)``.
Registration is explicit in ``register_all()``; there is no auto-discovery
or plugin scanning.

Tool contracts (enforced per-handler, not centralised):
  - ``record.user_id == ctx.current_user.id`` (auth — only own record)
  - ``record.status == "in_progress"`` (lifecycle gate)
  - ``is_enabled(record, tool_name)`` (capability gate)
  - All mutations happen inside the request-scoped DB session; no
    multi-transaction or detached commit in tool code.
  - Idempotency: each tool handler guards replay of the same action.
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
