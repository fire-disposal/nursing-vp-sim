"""Pydantic schemas — re-exported from domain modules.

Star imports cause cascading module loading (~15 submodules) when any schema is imported.
This is acceptable for a FastAPI server (cold start ≠ request-path perf).
New code preferred pattern: `from schemas.training import X`.
"""

from schemas.admin import *  # noqa: F403
from schemas.assignment import *  # noqa: F403
from schemas.auth import *  # noqa: F403
from schemas.case import *  # noqa: F403
from schemas.common import *  # noqa: F403
from schemas.feedback import *  # noqa: F403
from schemas.llm import *  # noqa: F403
from schemas.notification import *  # noqa: F403
from schemas.ops import *  # noqa: F403
from schemas.qa import *  # noqa: F403
from schemas.questionnaire import *  # noqa: F403
from schemas.scoreboard import *  # noqa: F403
from schemas.scoring import *  # noqa: F403
from schemas.training import *  # noqa: F403
from schemas.user import *  # noqa: F403
