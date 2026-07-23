from .router import router as training_router
from .router.chat import router as chat_router
from .student_views import router as student_router

__all__ = ["chat_router", "student_router", "training_router"]
