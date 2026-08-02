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


class UpdateCapableFakeSession:
    """In-memory Session fake supporting filter/update/delete — for optimistic-lock paths.

    Rows are keyed by model name + record_id so repositories that touch
    multiple tables (e.g. EmotionRepository: state + event rows) round-trip
    in memory without a database.
    """

    def __init__(self) -> None:
        self.rows_by_model: dict[str, list] = {}
        self.added: list[object] = []
        self.flush_count = 0

    def _bucket(self, model_name: str) -> list:
        if model_name not in self.rows_by_model:
            self.rows_by_model[model_name] = []
        return self.rows_by_model[model_name]

    def query(self, model: object) -> _UpdateQuery:
        return _UpdateQuery(self, getattr(model, "__name__", type(model).__name__))

    def add(self, obj: object) -> None:
        self.added.append(obj)
        self._bucket(type(obj).__name__).append(obj)

    def flush(self) -> None:
        self.flush_count += 1


class _FilterClause:
    def __init__(self, criteria: tuple) -> None:
        self.conditions: dict[str, object] = {}
        for c in criteria:
            left = getattr(c, "left", None)
            key = getattr(left, "key", None)
            right = getattr(c, "right", None)
            value = getattr(right, "value", right)
            if key is not None:
                self.conditions[key] = value

    def matches(self, row: object) -> bool:
        return all(getattr(row, k) == v for k, v in self.conditions.items())


class _UpdateQuery:
    def __init__(self, session: UpdateCapableFakeSession, model_name: str) -> None:
        self._session = session
        self._model_name = model_name
        self._clauses: list[_FilterClause] = []

    def filter(self, *criteria: object) -> _UpdateQuery:
        self._clauses.append(_FilterClause(criteria))
        return self

    def _rows(self) -> list:
        return [r for r in self._session._bucket(self._model_name) if all(c.matches(r) for c in self._clauses)]

    def first(self) -> object | None:
        rows = self._rows()
        return rows[0] if rows else None

    def all(self) -> list:
        return self._rows()

    def update(self, values: dict, **kwargs: object) -> int:
        rows = self._rows()
        for r in rows:
            for k, v in values.items():
                setattr(r, k, v)
        return len(rows)

    def delete(self) -> int:
        rows = self._rows()
        for r in rows:
            self._session._bucket(self._model_name).remove(r)
        return len(rows)
