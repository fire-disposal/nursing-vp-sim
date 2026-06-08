"""SyncRepository — base class for synchronous SQLAlchemy data access.

All DB operations run via asyncio.to_thread() to avoid blocking
the single event loop.
"""

import asyncio
from collections.abc import Callable
from typing import TypeVar

from sqlalchemy.orm import Session

from core.database import SessionLocal

T = TypeVar("T")


class SyncRepository:
    """Base class for repositories using synchronous SQLAlchemy sessions."""

    def __init__(self, session_factory=SessionLocal):
        self._session_factory = session_factory

    async def _run(self, fn: Callable[..., T], *args, **kwargs) -> T:
        """Execute fn(*args, **kwargs) in the default thread pool."""
        return await asyncio.to_thread(fn, *args, **kwargs)

    async def _run_in_session(self, fn: Callable[[Session], T]) -> T:
        """Execute fn(session) in a new session, auto-close after."""

        def _do() -> T:
            session = self._session_factory()
            try:
                return fn(session)
            finally:
                session.close()

        return await self._run(_do)
