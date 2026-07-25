from .router import router as training_router
from .router.chat import router as chat_router

__all__ = ["chat_router", "training_router"]
