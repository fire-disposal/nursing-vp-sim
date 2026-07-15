"""SyncRepository — base class for synchronous SQLAlchemy data access.

All DB operations run via asyncio.to_thread() to avoid blocking
the single event loop.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import TYPE_CHECKING, Generic, TypeVar

from core.database import SessionLocal
from core.exceptions import NotFoundError

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

T = TypeVar("T")
TModel = TypeVar("TModel")


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


class Repository(Generic[TModel]):
    """Synchronous request-path repository base.

    Subclasses set ``model`` and receive a request-scoped ``Session``.
    Methods ``flush`` (never ``commit``) — committing is the caller's
    ``unit_of_work`` responsibility.
    """

    model: type[TModel]

    def __init__(self, db: Session):
        self.db = db

    def get(self, id_: int) -> TModel | None:
        return self.db.get(self.model, id_)

    def get_or_404(self, id_: int, detail: str = "资源不存在") -> TModel:
        obj = self.get(id_)
        if obj is None:
            raise NotFoundError(detail)
        return obj

    def query(self):
        return self.db.query(self.model)

    def list(self, *criteria, order_by=None) -> list[TModel]:
        q = self.query()
        if criteria:
            q = q.filter(*criteria)
        if order_by is not None:
            q = q.order_by(order_by)
        return q.all()

    def exists(self, *criteria) -> bool:
        return bool(self.db.query(self.query().filter(*criteria).exists()).scalar())

    def add(self, obj: TModel) -> TModel:
        self.db.add(obj)
        self.db.flush()
        return obj

    def delete(self, obj: TModel) -> None:
        self.db.delete(obj)
        self.db.flush()
