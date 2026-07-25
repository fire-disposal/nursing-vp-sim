from .base import ToolContext, ToolHandler, ToolResult
from .registry import dispatch, register, registry


def register_all():
    """Auto-discover and register all tool handlers."""
    from .mews import MewsHandler
    from .nursing_record import NursingRecordHandler
    from .physical_exam import PhysicalExamHandler
    from .quiz import QuizHandler

    register(PhysicalExamHandler())
    register(NursingRecordHandler())
    register(QuizHandler())
    register(MewsHandler())


__all__ = ["ToolContext", "ToolHandler", "ToolResult", "dispatch", "register", "register_all", "registry"]
