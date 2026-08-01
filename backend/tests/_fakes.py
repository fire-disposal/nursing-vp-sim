"""Minimal in-memory Session stand-in for pure unit tests.

``EmotionCache`` / ``InitiativeCache`` only touch the session through
``query().filter().first()`` and ``add()`` / ``flush()`` / ``delete()``.
This fake keeps added rows keyed by ``record_id`` so set-then-get round
trips work in memory without a database.
"""

from __future__ import annotations


class FakeSession:
    def __init__(self) -> None:
        self.rows: dict[int, object] = {}
        self.added: list[object] = []
        self.deleted: list[object] = []

    def query(self, _model: object) -> _Query:
        return _Query(self)

    def add(self, obj: object) -> None:
        self.added.append(obj)
        self.rows[obj.record_id] = obj  # type: ignore[attr-defined]

    def flush(self) -> None:
        pass

    def delete(self, obj: object) -> None:
        self.deleted.append(obj)
        self.rows.pop(obj.record_id, None)  # type: ignore[attr-defined]


class _Query:
    def __init__(self, session: FakeSession) -> None:
        self._session = session
        self._record_id: int | None = None

    def filter(self, *_criteria: object) -> _Query:
        # Criteria are SQLAlchemy BinaryExpressions (col == value); the
        # literal side carries the record_id we key rows by.
        for c in _criteria:
            right = getattr(c, "right", None)
            value = getattr(right, "value", right)
            if isinstance(value, int):
                self._record_id = value
        return self

    def order_by(self, *_criteria: object) -> _Query:
        return self

    def first(self) -> object | None:
        if self._record_id is None:
            return None
        return self._session.rows.get(self._record_id)

    def all(self) -> list:
        return []
